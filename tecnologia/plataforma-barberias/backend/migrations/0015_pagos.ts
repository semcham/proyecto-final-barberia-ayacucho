import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T018 · Funcionalidad 003: pagos, períodos pagados, comprobantes y eventos del proveedor (data-model.md
// §1.2 y §1.3, research R03 a R05 y R09; principio V; ADR-022 y ADR-023).
//
// Garantías de dinero en PostgreSQL (como las de las citas, principio IV):
// - subscription_period_sin_solape: los períodos de una suscripción nunca se solapan (FR-004).
// - UNIQUE (payment_id): un pago crea a lo sumo un período. La FK compuesta exige que el período sea de la
//   misma suscripción y del mismo plan que su pago, y la duración queda entre 28 y 31 días.
// - payment_un_pago_abierto: un solo pago abierto (pendiente, esperando comprobante o en revisión) por
//   suscripción (FR-012). Dos intentos simultáneos dejan una sola fila.
// - payment_numero_operacion_aprobado: un número de operación bancaria se aprueba una sola vez entre todas
//   las barberías (FR-022b). El índice no se filtra por RLS: es global a propósito.
// - Importes en céntimos enteros y positivos, moneda PEN (FR-005b).
// - bank_operation_last4 y bank_operation_hash los calcula la base a partir del número normalizado
//   (columnas generadas): ningún código puede guardarlos desalineados (H2).
// - provider_event (tabla de la plataforma, constitución 1.3.1): sin RLS y sin datos del pagador. El rol de
//   la aplicación SOLO inserta (C1): sin SELECT ni UPDATE, deduplica con ON CONFLICT DO NOTHING. Sin destino
//   a propósito: ON CONFLICT (event_id) exige SELECT sobre event_id, y event_id es la única clave única.

export const ESTADOS_PAGO = [
  'PENDIENTE',
  'ESPERANDO_COMPROBANTE',
  'EN_REVISION',
  'APROBADO',
  'RECHAZADO',
  'ANULADO',
  'EXPIRADO',
] as const;

export const MARCAS_REVISION = [
  'DUPLICADO',
  'IMPORTE_DISTINTO',
  'APROBADO_TRAS_RECHAZO',
  'DEVOLUCION',
  'NUMERO_REPETIDO',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE payment (
      id                       uuid PRIMARY KEY,
      tenant_id                uuid         NOT NULL REFERENCES tenant (id),
      subscription_id          uuid         NOT NULL,
      plan_id                  uuid         NOT NULL REFERENCES plan (id),
      amount_cents             int          NOT NULL CHECK (amount_cents > 0),
      currency                 char(3)      NOT NULL DEFAULT 'PEN' CHECK (currency = 'PEN'),
      method                   varchar(16)  NOT NULL CHECK (method IN ('YAPE', 'TRANSFERENCIA', 'MANUAL')),
      status                   varchar(24)  NOT NULL CHECK (status IN (${lista(ESTADOS_PAGO)})),
      covers_after             timestamptz  NOT NULL,
      review                   varchar(24)  CHECK (review IN (${lista(MARCAS_REVISION)})),
      review_resolved_at       timestamptz,
      review_note              varchar(300),
      provider_reference       varchar(80)  UNIQUE,
      checkout_url_expires_at  timestamptz,
      transfer_reference       varchar(32)  UNIQUE CHECK (transfer_reference ~ '^SUS-[A-Z0-9]{4,28}$'),
      bank_operation_number    varchar(40)  CHECK (bank_operation_number ~ '^[A-Z0-9]{6,40}$'),
      bank_operation_last4     char(4)      GENERATED ALWAYS AS (right(bank_operation_number, 4)) STORED,
      bank_operation_hash      char(64)
        GENERATED ALWAYS AS (encode(sha256(decode(bank_operation_number, 'escape')), 'hex')) STORED,
      transfer_date            date,
      rejection_reason         varchar(300) CHECK (char_length(btrim(rejection_reason)) BETWEEN 5 AND 300),
      manual_reason            varchar(300) CHECK (char_length(btrim(manual_reason)) BETWEEN 5 AND 300),
      manual_external_ref      varchar(80),
      created_by               uuid         NOT NULL,
      created_at               timestamptz  NOT NULL DEFAULT now(),
      approved_at              timestamptz,
      closed_at                timestamptz,
      UNIQUE (tenant_id, id),
      UNIQUE (tenant_id, id, subscription_id, plan_id),
      FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscription (tenant_id, id),
      -- Cada medio con sus datos y solo con ellos.
      CONSTRAINT payment_datos_del_medio CHECK (
        (method = 'YAPE' AND transfer_reference IS NULL AND bank_operation_number IS NULL
          AND transfer_date IS NULL AND manual_reason IS NULL AND manual_external_ref IS NULL)
        OR (method = 'TRANSFERENCIA' AND transfer_reference IS NOT NULL AND provider_reference IS NULL
          AND checkout_url_expires_at IS NULL AND manual_reason IS NULL AND manual_external_ref IS NULL)
        OR (method = 'MANUAL' AND manual_reason IS NOT NULL AND provider_reference IS NULL
          AND checkout_url_expires_at IS NULL AND transfer_reference IS NULL AND bank_operation_number IS NULL)
      ),
      -- Estados posibles por medio (data-model.md §3): estados imposibles, imposibles en la base.
      CONSTRAINT payment_estado_del_medio CHECK (
        (status <> 'PENDIENTE' OR method = 'YAPE')
        AND (status NOT IN ('ESPERANDO_COMPROBANTE', 'EN_REVISION') OR method = 'TRANSFERENCIA')
        AND (method <> 'MANUAL' OR status = 'APROBADO')
      ),
      CONSTRAINT payment_aprobado_con_fecha CHECK ((status = 'APROBADO') = (approved_at IS NOT NULL)),
      CONSTRAINT payment_en_revision_con_numero
        CHECK (status <> 'EN_REVISION' OR (bank_operation_number IS NOT NULL AND transfer_date IS NOT NULL)),
      CONSTRAINT payment_transferencia_aprobada_con_numero
        CHECK (method <> 'TRANSFERENCIA' OR status <> 'APROBADO' OR bank_operation_number IS NOT NULL),
      CONSTRAINT payment_rechazo_de_transferencia_con_motivo
        CHECK (method <> 'TRANSFERENCIA' OR status <> 'RECHAZADO' OR rejection_reason IS NOT NULL),
      CONSTRAINT payment_cerrado_con_fecha
        CHECK ((status IN ('PENDIENTE', 'ESPERANDO_COMPROBANTE', 'EN_REVISION')) = (closed_at IS NULL)),
      CONSTRAINT payment_marca_resuelta
        CHECK (review_resolved_at IS NULL OR review IS NOT NULL),
      CONSTRAINT payment_nota_de_resolucion
        CHECK ((review_resolved_at IS NULL) = (review_note IS NULL))
    );
    CREATE UNIQUE INDEX payment_un_pago_abierto ON payment (subscription_id)
      WHERE status IN ('PENDIENTE', 'ESPERANDO_COMPROBANTE', 'EN_REVISION');
    CREATE UNIQUE INDEX payment_numero_operacion_aprobado ON payment (bank_operation_number)
      WHERE status = 'APROBADO' AND bank_operation_number IS NOT NULL;
    CREATE INDEX payment_historial ON payment (tenant_id, created_at DESC);
    CREATE INDEX payment_pendientes ON payment (created_at) WHERE status = 'PENDIENTE';
    CREATE INDEX payment_esperando_comprobante ON payment (created_at) WHERE status = 'ESPERANDO_COMPROBANTE';
    CREATE INDEX payment_por_revisar ON payment (created_at)
      WHERE review IS NOT NULL AND review_resolved_at IS NULL;
    CREATE INDEX payment_hash_numero ON payment (bank_operation_hash) WHERE bank_operation_hash IS NOT NULL;

    CREATE TABLE subscription_period (
      id               uuid PRIMARY KEY,
      tenant_id        uuid        NOT NULL REFERENCES tenant (id),
      subscription_id  uuid        NOT NULL,
      payment_id       uuid        NOT NULL,
      plan_id          uuid        NOT NULL REFERENCES plan (id),
      starts_at        timestamptz NOT NULL,
      ends_at          timestamptz NOT NULL,
      created_at       timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      CONSTRAINT subscription_period_un_periodo_por_pago UNIQUE (payment_id),
      FOREIGN KEY (tenant_id, subscription_id) REFERENCES subscription (tenant_id, id),
      -- El período es de la misma barbería, suscripción y plan que el pago que lo paga.
      FOREIGN KEY (tenant_id, payment_id, subscription_id, plan_id)
        REFERENCES payment (tenant_id, id, subscription_id, plan_id),
      CONSTRAINT subscription_period_duracion_mensual
        CHECK (ends_at - starts_at BETWEEN interval '28 days' AND interval '31 days'),
      CONSTRAINT subscription_period_sin_solape
        EXCLUDE USING gist (subscription_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    );
    CREATE INDEX subscription_period_cobertura ON subscription_period (subscription_id, starts_at);

    CREATE TABLE payment_receipt (
      id             uuid PRIMARY KEY,
      tenant_id      uuid        NOT NULL REFERENCES tenant (id),
      payment_id     uuid        NOT NULL,
      content_type   varchar(20) NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'application/pdf')),
      size_bytes     int         NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
      sha256         char(64)    NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      uploaded_by    uuid        NOT NULL,
      uploaded_at    timestamptz NOT NULL DEFAULT now(),
      reviewed_by    uuid,
      reviewed_at    timestamptz,
      review_result  varchar(12) CHECK (review_result IN ('APROBADO', 'RECHAZADO')),
      review_reason  varchar(300),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, payment_id) REFERENCES payment (tenant_id, id),
      CONSTRAINT payment_receipt_revision_completa
        CHECK ((reviewed_at IS NULL) = (review_result IS NULL) AND (reviewed_at IS NULL) = (reviewed_by IS NULL)),
      CONSTRAINT payment_receipt_rechazo_con_motivo
        CHECK (review_result IS DISTINCT FROM 'RECHAZADO' OR review_reason IS NOT NULL)
    );
    -- Un solo comprobante en revisión por pago.
    CREATE UNIQUE INDEX payment_receipt_uno_en_revision ON payment_receipt (payment_id) WHERE reviewed_at IS NULL;
    CREATE INDEX payment_receipt_sha256 ON payment_receipt (sha256);

    CREATE TABLE payment_receipt_file (
      tenant_id   uuid  NOT NULL,
      receipt_id  uuid  NOT NULL,
      content     bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
      PRIMARY KEY (tenant_id, receipt_id),
      FOREIGN KEY (tenant_id, receipt_id) REFERENCES payment_receipt (tenant_id, id)
    );
    -- JPEG, PNG y PDF ya vienen comprimidos: sin compresión de TOAST.
    ALTER TABLE payment_receipt_file ALTER COLUMN content SET STORAGE EXTERNAL;

    CREATE TABLE receipt_upload_counter (
      tenant_id  uuid NOT NULL REFERENCES tenant (id),
      day        date NOT NULL,
      count      int  NOT NULL CHECK (count BETWEEN 0 AND 5),
      PRIMARY KEY (tenant_id, day)
    );

    CREATE TABLE provider_event (
      event_id            varchar(80) PRIMARY KEY,
      received_at         timestamptz NOT NULL DEFAULT now(),
      provider_reference  varchar(80) NOT NULL,
      reported_status     varchar(16) NOT NULL
        CHECK (reported_status IN ('APROBADO', 'RECHAZADO', 'PENDIENTE', 'EXPIRADO', 'DEVUELTO')),
      amount_cents        int         CHECK (amount_cents >= 0),
      currency            char(3),
      tenant_id           uuid,
      payment_id          uuid,
      effect              varchar(12) NOT NULL CHECK (effect IN ('APLICADO', 'SIN_EFECTO', 'REVISION', 'SIN_PAGO')),
      FOREIGN KEY (tenant_id, payment_id) REFERENCES payment (tenant_id, id),
      CONSTRAINT provider_event_pago_completo CHECK ((tenant_id IS NULL) = (payment_id IS NULL)),
      CONSTRAINT provider_event_sin_pago CHECK ((effect = 'SIN_PAGO') = (payment_id IS NULL))
    );
    CREATE INDEX provider_event_por_pago ON provider_event (payment_id) WHERE payment_id IS NOT NULL;

    ${rlsPorTenant('payment')}
    ${rlsPorTenant('subscription_period')}
    ${rlsPorTenant('payment_receipt')}
    ${rlsPorTenant('payment_receipt_file')}
    ${rlsPorTenant('receipt_upload_counter')}

    -- Permisos del rol de la aplicación (data-model.md §4). Nada se borra: los pagos y los períodos son
    -- historia de dinero.
    GRANT SELECT, INSERT ON payment TO barberias_app;
    GRANT UPDATE (status, review, review_resolved_at, review_note, provider_reference, checkout_url_expires_at,
                  bank_operation_number, transfer_date, rejection_reason, approved_at, closed_at)
      ON payment TO barberias_app;
    GRANT SELECT, INSERT ON subscription_period TO barberias_app;
    GRANT SELECT, INSERT ON payment_receipt TO barberias_app;
    GRANT UPDATE (reviewed_by, reviewed_at, review_result, review_reason) ON payment_receipt TO barberias_app;
    GRANT SELECT, INSERT ON payment_receipt_file TO barberias_app;
    GRANT SELECT, INSERT, UPDATE ON receipt_upload_counter TO barberias_app;
    -- C1 (constitución 1.3.1): solo insertar eventos, nunca leerlos ni cambiarlos.
    GRANT INSERT ON provider_event TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS provider_event;
    DROP TABLE IF EXISTS receipt_upload_counter;
    DROP TABLE IF EXISTS payment_receipt_file;
    DROP TABLE IF EXISTS payment_receipt;
    DROP TABLE IF EXISTS subscription_period;
    DROP TABLE IF EXISTS payment;
  `,
    )
    .execute(db);
}
