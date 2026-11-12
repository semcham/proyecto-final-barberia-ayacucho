import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T007 · Funcionalidad 008: configuración del adelanto de reserva y sus archivos privados (data-model.md §1, §2 y §7
// de 008; research R05).
//
// - booking_deposit_file: el QR de Yape o Plin de la barbería y las capturas de pago, en bytea, con tipo, tamaño y
//   SHA-256, igual de privados que payment_receipt_file de 003 (ADR-023): sin URL pública ni nombre original.
//   Inmutable para la aplicación (sin UPDATE ni DELETE): reemplazar el QR inserta otro archivo y el anterior se
//   conserva para las citas reservadas con él (FR-004).
// - booking_deposit_settings: una fila por barbería. Con el adelanto activo exige el tipo, su valor, el plazo y
//   el QR (FR-002).
// - Tablas de barbería con RLS forzada (principio III). barberias_plataforma, barberias_publico y barberias_auth
//   no reciben nada.

export const TIPOS_DE_ARCHIVO_DE_ADELANTO = ['QR', 'CAPTURA'] as const;

/** UPDATE por columna de barberias_app sobre la configuración: todas menos tenant_id (data-model §7). */
export const UPDATE_APP_CONFIGURACION_ADELANTO = [
  'enabled',
  'kind',
  'amount_cents',
  'percent',
  'payment_window_minutes',
  'qr_file_id',
  'updated_at',
  'updated_by',
] as const;

const UN_MB = 1048576;
const CINCO_MB = 5242880;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE booking_deposit_file (
      id            uuid PRIMARY KEY,
      tenant_id     uuid         NOT NULL REFERENCES tenant (id),
      kind          varchar(8)   NOT NULL CHECK (kind IN ('QR', 'CAPTURA')),
      content_type  varchar(20)  NOT NULL,
      size_bytes    int          NOT NULL,
      sha256        char(64)     NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
      content       bytea        NOT NULL,
      created_at    timestamptz  NOT NULL DEFAULT now(),
      created_by    uuid         NOT NULL,
      UNIQUE (tenant_id, id),
      -- El QR es una imagen JPEG o PNG de hasta 1 MB; la captura, además un PDF, de hasta 5 MB (research R05).
      CONSTRAINT booking_deposit_file_tipo CHECK (
        (kind = 'QR' AND content_type IN ('image/jpeg', 'image/png') AND size_bytes BETWEEN 1 AND ${UN_MB})
        OR (kind = 'CAPTURA' AND content_type IN ('image/jpeg', 'image/png', 'application/pdf')
            AND size_bytes BETWEEN 1 AND ${CINCO_MB})
      ),
      CONSTRAINT booking_deposit_file_tamano CHECK (octet_length(content) = size_bytes)
    );
    -- JPEG, PNG y PDF ya vienen comprimidos: sin compresión de TOAST.
    ALTER TABLE booking_deposit_file ALTER COLUMN content SET STORAGE EXTERNAL;

    CREATE TABLE booking_deposit_settings (
      tenant_id               uuid PRIMARY KEY REFERENCES tenant (id),
      enabled                 boolean      NOT NULL DEFAULT false,
      kind                    varchar(10)  CHECK (kind IN ('FIJO', 'PORCENTAJE')),
      amount_cents            int          CHECK (amount_cents BETWEEN 100 AND 50000),
      percent                 smallint     CHECK (percent BETWEEN 1 AND 100),
      payment_window_minutes  smallint     CHECK (payment_window_minutes BETWEEN 10 AND 1440),
      qr_file_id              uuid,
      updated_at              timestamptz  NOT NULL DEFAULT now(),
      updated_by              uuid         NOT NULL,
      FOREIGN KEY (tenant_id, qr_file_id) REFERENCES booking_deposit_file (tenant_id, id),
      -- Cada tipo con su valor y solo con él; sin tipo, sin valores.
      CONSTRAINT booking_deposit_settings_valor CHECK (
        (kind IS NULL AND amount_cents IS NULL AND percent IS NULL)
        OR (kind = 'FIJO' AND amount_cents IS NOT NULL AND percent IS NULL)
        OR (kind = 'PORCENTAJE' AND percent IS NOT NULL AND amount_cents IS NULL)
      ),
      -- Activo exige el tipo, su valor, el plazo y el QR (FR-002).
      CONSTRAINT booking_deposit_settings_activo_completo CHECK (
        NOT enabled OR (kind IS NOT NULL AND payment_window_minutes IS NOT NULL AND qr_file_id IS NOT NULL)
      )
    );

    ${rlsPorTenant('booking_deposit_file')}
    ${rlsPorTenant('booking_deposit_settings')}

    GRANT SELECT, INSERT ON booking_deposit_file TO barberias_app;
    GRANT SELECT, INSERT ON booking_deposit_settings TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_CONFIGURACION_ADELANTO.join(', ')}) ON booking_deposit_settings TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS booking_deposit_settings;
    DROP TABLE IF EXISTS booking_deposit_file;
  `,
    )
    .execute(db);
}
