import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T007 · Funcionalidad 008: el adelanto de cada cita y los registros de pago del cliente (data-model.md §3, §4, §5 y
// §7 de 008; research R04, R06, R07, R09).
//
// - booking_deposit: uno por cita (UNIQUE (tenant_id, appointment_id)), con el código de la reserva único en la
//   barbería, el monto y los plazos calculados al reservar, y copias del servicio, la hora y la zona para los avisos.
// - booking_deposit_payment: el número de operación normalizado, único en la barbería también si se rechazó, y un
//   solo registro vigente (no rechazado) por adelanto, también con dos registros simultáneos (US2-5).
// - barberias_app: SELECT, INSERT y UPDATE solo de las columnas que cambian. Sin DELETE.
// - barberias_plataforma: SELECT de cinco columnas técnicas de booking_deposit, con la política
//   plataforma_lectura, para que la tarea vencer-adelantos liste los candidatos de todas las barberías
//   (ADR-031). Nada del monto, el código, el cliente ni los pagos.

export const ESTADOS_ADELANTO = [
  'POR_PAGAR',
  'POR_REVISAR',
  'CONFIRMADO',
  'VENCIDO',
  'ANULADO',
  'POR_DEVOLVER',
  'DEVUELTO',
  'RETENIDO',
] as const;

/** SELECT por columna de barberias_plataforma (lista cerrada; la compara lectura-plataforma.spec.ts). */
export const COLUMNAS_PLATAFORMA_ADELANTOS: Record<string, readonly string[]> = {
  booking_deposit: ['id', 'tenant_id', 'status', 'due_at', 'review_limit_at'],
};

export const UPDATE_APP_ADELANTO = [
  'status',
  'resolved_at',
  'refunded_at',
  'refunded_by',
  'service_name',
  'starts_at',
  'time_zone',
] as const;

export const UPDATE_APP_PAGO_ADELANTO = [
  'review_result',
  'reviewed_at',
  'reviewed_by',
  'rejection_reason',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE booking_deposit (
      id                   uuid PRIMARY KEY,
      tenant_id            uuid         NOT NULL REFERENCES tenant (id),
      appointment_id       uuid         NOT NULL,
      customer_id          uuid         NOT NULL,
      customer_user_id     uuid         NOT NULL,
      code                 char(6)      NOT NULL CHECK (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{6}$'),
      amount_cents         int          NOT NULL CHECK (amount_cents > 0),
      service_price_cents  int          NOT NULL,
      service_name         varchar(80)  NOT NULL,
      starts_at            timestamptz  NOT NULL,
      time_zone            varchar(40)  NOT NULL,
      qr_file_id           uuid         NOT NULL,
      due_at               timestamptz  NOT NULL,
      review_limit_at      timestamptz  NOT NULL,
      status               varchar(12)  NOT NULL DEFAULT 'POR_PAGAR' CHECK (status IN (${lista(ESTADOS_ADELANTO)})),
      resolved_at          timestamptz,
      refunded_at          timestamptz,
      refunded_by          uuid,
      created_at           timestamptz  NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      CONSTRAINT booking_deposit_una_por_cita UNIQUE (tenant_id, appointment_id),
      CONSTRAINT booking_deposit_codigo_unico UNIQUE (tenant_id, code),
      FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointment (tenant_id, id),
      FOREIGN KEY (tenant_id, qr_file_id) REFERENCES booking_deposit_file (tenant_id, id),
      -- El adelanto nunca supera el precio (saldo = precio − adelanto, FR-020).
      CONSTRAINT booking_deposit_monto CHECK (amount_cents <= service_price_cents),
      CONSTRAINT booking_deposit_plazos CHECK (review_limit_at >= due_at),
      -- Pendiente (por pagar o por revisar) mientras no se resuelve; después, con su fecha.
      CONSTRAINT booking_deposit_resuelto
        CHECK ((status IN ('POR_PAGAR', 'POR_REVISAR')) = (resolved_at IS NULL)),
      -- La marca de devuelto (aclaración Q2): solo DEVUELTO, con fecha y quién.
      CONSTRAINT booking_deposit_devuelto
        CHECK ((status = 'DEVUELTO') = (refunded_at IS NOT NULL) AND (refunded_at IS NULL) = (refunded_by IS NULL))
    );
    -- Tarea vencer-adelantos: los por pagar por hora límite y los por revisar por límite máximo adicional.
    CREATE INDEX booking_deposit_por_pagar ON booking_deposit (due_at) WHERE status = 'POR_PAGAR';
    CREATE INDEX booking_deposit_por_revisar ON booking_deposit (review_limit_at) WHERE status = 'POR_REVISAR';

    CREATE TABLE booking_deposit_payment (
      id                uuid PRIMARY KEY,
      tenant_id         uuid          NOT NULL REFERENCES tenant (id),
      deposit_id        uuid          NOT NULL,
      operation_number  varchar(20)   NOT NULL CHECK (operation_number ~ '^[A-Z0-9]{4,20}$'),
      file_id           uuid,
      registered_at     timestamptz   NOT NULL DEFAULT now(),
      registered_by     uuid          NOT NULL,
      review_result     varchar(10)   CHECK (review_result IN ('CONFIRMADO', 'RECHAZADO')),
      reviewed_at       timestamptz,
      reviewed_by       uuid,
      rejection_reason  varchar(300)  CHECK (char_length(btrim(rejection_reason)) BETWEEN 5 AND 300),
      UNIQUE (tenant_id, id),
      -- Único en la barbería, también si el registro se rechazó (research R07).
      CONSTRAINT booking_deposit_payment_numero_unico UNIQUE (tenant_id, operation_number),
      FOREIGN KEY (tenant_id, deposit_id) REFERENCES booking_deposit (tenant_id, id),
      FOREIGN KEY (tenant_id, file_id) REFERENCES booking_deposit_file (tenant_id, id),
      CONSTRAINT booking_deposit_payment_revision_completa
        CHECK ((reviewed_at IS NULL) = (review_result IS NULL) AND (reviewed_at IS NULL) = (reviewed_by IS NULL)),
      -- El motivo es obligatorio si y solo si se rechazó (FR-014).
      CONSTRAINT booking_deposit_payment_motivo
        CHECK ((review_result IS NOT DISTINCT FROM 'RECHAZADO') = (rejection_reason IS NOT NULL))
    );
    -- Un solo registro vigente por adelanto (US2-5).
    CREATE UNIQUE INDEX booking_deposit_payment_uno_vigente ON booking_deposit_payment (tenant_id, deposit_id)
      WHERE review_result IS DISTINCT FROM 'RECHAZADO';

    ${rlsPorTenant('booking_deposit')}
    ${rlsPorTenant('booking_deposit_payment')}
    CREATE POLICY plataforma_lectura ON booking_deposit FOR SELECT TO barberias_plataforma USING (true);

    GRANT SELECT, INSERT ON booking_deposit TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_ADELANTO.join(', ')}) ON booking_deposit TO barberias_app;
    GRANT SELECT, INSERT ON booking_deposit_payment TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_PAGO_ADELANTO.join(', ')}) ON booking_deposit_payment TO barberias_app;
    GRANT SELECT (${COLUMNAS_PLATAFORMA_ADELANTOS.booking_deposit.join(', ')}) ON booking_deposit TO barberias_plataforma;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS booking_deposit_payment;
    DROP TABLE IF EXISTS booking_deposit;
  `,
    )
    .execute(db);
}
