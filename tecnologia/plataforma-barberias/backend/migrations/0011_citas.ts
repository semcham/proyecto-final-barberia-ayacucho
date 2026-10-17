import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T008 · Citas (funcionalidad 002, RF12, RF14, RF15; principio IV, ADR-009, research R06 y R09).
//
// - period: rango semiabierto [inicio, fin) generado; permite citas seguidas (10:00–10:30 y 10:30–11:00).
// - appointment_no_overlap_barber: nunca dos citas activas (PENDIENTE o CONFIRMADA) del mismo barbero que
//   se solapen. Es la garantía de la constitución (principio IV); el repositorio traduce su violación
//   (23P01) a "horario no disponible".
// - appointment_no_overlap_customer: un cliente no tiene dos citas activas que se solapen (FR-033).
// - Idempotencia de la reserva (R09): clave y hash del contenido en la propia fila, únicos por autor.
// - La cita copia nombre, precio y duración del servicio al reservar (FR-008).
// - barberias_app no puede borrar citas ni su historial.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE EXTENSION IF NOT EXISTS btree_gist;

    CREATE TABLE appointment (
      id                 uuid PRIMARY KEY,
      tenant_id          uuid          NOT NULL REFERENCES tenant (id),
      barber_id          uuid          NOT NULL,
      service_id         uuid          NOT NULL,
      customer_id        uuid          NOT NULL,
      service_name       varchar(80)   NOT NULL,
      price              numeric(10,2) NOT NULL CHECK (price >= 0),
      duration_min       smallint      NOT NULL CHECK (duration_min > 0),
      starts_at          timestamptz   NOT NULL,
      ends_at            timestamptz   NOT NULL,
      period             tstzrange     GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
      status             varchar(12)   NOT NULL
        CHECK (status IN ('PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'NO_ASISTIO', 'CANCELADA')),
      origin             varchar(16)   NOT NULL CHECK (origin IN ('EN_LINEA', 'PRESENCIAL')),
      late_cancellation  boolean       NOT NULL DEFAULT false,
      created_by         uuid          NOT NULL,
      cancelled_by       uuid,
      cancelled_at       timestamptz,
      cancel_reason      varchar(200),
      idempotency_key    uuid,
      request_hash       char(64),
      created_at         timestamptz   NOT NULL DEFAULT now(),
      updated_at         timestamptz   NOT NULL DEFAULT now(),
      CHECK (starts_at < ends_at),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, barber_id) REFERENCES barber (tenant_id, id),
      FOREIGN KEY (tenant_id, service_id) REFERENCES service (tenant_id, id),
      FOREIGN KEY (tenant_id, customer_id) REFERENCES customer_profile (tenant_id, id),
      CONSTRAINT appointment_no_overlap_barber
        EXCLUDE USING gist (tenant_id WITH =, barber_id WITH =, period WITH &&)
        WHERE (status IN ('PENDIENTE', 'CONFIRMADA')),
      CONSTRAINT appointment_no_overlap_customer
        EXCLUDE USING gist (tenant_id WITH =, customer_id WITH =, period WITH &&)
        WHERE (status IN ('PENDIENTE', 'CONFIRMADA')),
      CONSTRAINT appointment_cancelacion_coherente
        CHECK ((status = 'CANCELADA') = (cancelled_at IS NOT NULL)),
      CONSTRAINT appointment_idempotencia_completa
        CHECK ((idempotency_key IS NULL) = (request_hash IS NULL))
    );
    CREATE UNIQUE INDEX appointment_idempotencia
      ON appointment (tenant_id, created_by, idempotency_key) WHERE idempotency_key IS NOT NULL;
    CREATE INDEX appointment_agenda ON appointment (tenant_id, starts_at);
    CREATE INDEX appointment_cliente ON appointment (tenant_id, customer_id, starts_at DESC);

    CREATE TABLE appointment_status_history (
      id              uuid PRIMARY KEY,
      tenant_id       uuid        NOT NULL REFERENCES tenant (id),
      appointment_id  uuid        NOT NULL,
      from_status     varchar(12),
      to_status       varchar(12) NOT NULL,
      changed_by      uuid        NOT NULL,
      changed_at      timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, appointment_id) REFERENCES appointment (tenant_id, id)
    );
    CREATE INDEX appointment_status_history_cita
      ON appointment_status_history (tenant_id, appointment_id, changed_at);

    ${rlsPorTenant('appointment')}
    ${rlsPorTenant('appointment_status_history')}

    GRANT SELECT, INSERT ON appointment TO barberias_app;
    GRANT UPDATE (status, late_cancellation, cancelled_by, cancelled_at, cancel_reason, updated_at)
      ON appointment TO barberias_app;
    -- Inmutable para la aplicación (FR-043).
    GRANT SELECT, INSERT ON appointment_status_history TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS appointment_status_history;
    DROP TABLE IF EXISTS appointment;
  `,
    )
    .execute(db);
}
