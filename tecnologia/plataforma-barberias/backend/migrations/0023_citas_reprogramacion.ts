import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T023 · Funcionalidad 004: reprogramación de citas y uso de los enlaces de acción (M02, RF13 y RF34;
// data-model.md §1).
//
// - appointment gana `version` (sube al reprogramar, cancelar, completar o no asistió: invalida los enlaces) y
//   `client_confirmed_at`. barberias_app puede actualizar, columna por columna, solo lo que mueve una cita;
//   las restricciones de exclusión de 0011 no cambian (principio IV).
// - appointment_reschedule: historial inmutable de las reprogramaciones.
// - appointment_link_use: el USO de un enlace (nada se guarda al emitirlo). UNIQUE (link_hash) es global a
//   propósito: el segundo uso choca (23505) y un mismo token nunca vale en dos barberías.

export const UPDATE_APP_REPROGRAMAR = [
  'barber_id',
  'starts_at',
  'ends_at',
  'version',
  'client_confirmed_at',
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE appointment
      ADD COLUMN version              int NOT NULL DEFAULT 1 CHECK (version >= 1),
      ADD COLUMN client_confirmed_at  timestamptz;
    GRANT UPDATE (${UPDATE_APP_REPROGRAMAR.join(', ')}) ON appointment TO barberias_app;

    CREATE TABLE appointment_reschedule (
      id              uuid PRIMARY KEY,
      tenant_id       uuid         NOT NULL REFERENCES tenant (id),
      appointment_id  uuid         NOT NULL,
      from_barber_id  uuid         NOT NULL,
      from_starts_at  timestamptz  NOT NULL,
      to_barber_id    uuid         NOT NULL,
      to_starts_at    timestamptz  NOT NULL,
      changed_by      uuid,
      via             varchar(12)  NOT NULL CHECK (via IN ('SESION', 'ENLACE')),
      changed_at      timestamptz  NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointment (tenant_id, id),
      CONSTRAINT appointment_reschedule_con_cambio
        CHECK (from_starts_at <> to_starts_at OR from_barber_id <> to_barber_id),
      -- Por sesión hay un usuario que reprograma; por enlace, no.
      CONSTRAINT appointment_reschedule_autor CHECK ((via = 'SESION') = (changed_by IS NOT NULL))
    );
    CREATE INDEX appointment_reschedule_cita ON appointment_reschedule (tenant_id, appointment_id, changed_at);

    CREATE TABLE appointment_link_use (
      id              uuid PRIMARY KEY,
      tenant_id       uuid         NOT NULL REFERENCES tenant (id),
      appointment_id  uuid         NOT NULL,
      link_hash       char(64)     NOT NULL CHECK (link_hash ~ '^[0-9a-f]{64}$'),
      action          varchar(12)  NOT NULL CHECK (action IN ('CONFIRMAR', 'REPROGRAMAR', 'CANCELAR')),
      used_at         timestamptz  NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      CONSTRAINT appointment_link_use_un_uso UNIQUE (link_hash),
      FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointment (tenant_id, id)
    );

    ${rlsPorTenant('appointment_reschedule')}
    ${rlsPorTenant('appointment_link_use')}

    -- Inmutables para la aplicación: sin UPDATE ni DELETE.
    GRANT SELECT, INSERT ON appointment_reschedule TO barberias_app;
    GRANT SELECT, INSERT ON appointment_link_use TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS appointment_link_use;
    DROP TABLE IF EXISTS appointment_reschedule;
    REVOKE UPDATE (${UPDATE_APP_REPROGRAMAR.join(', ')}) ON appointment FROM barberias_app;
    ALTER TABLE appointment DROP COLUMN IF EXISTS client_confirmed_at, DROP COLUMN IF EXISTS version;
  `,
    )
    .execute(db);
}
