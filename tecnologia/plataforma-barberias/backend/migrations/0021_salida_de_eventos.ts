import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T021 · Funcionalidad 004: salida transaccional de eventos de M06 (ADR-025; data-model.md §3).
//
// outbox_event es una tabla de barbería: todo evento lleva su tenant y RLS forzada (principio III). Los
// casos de uso la escriben en su propia transacción por el bus de M06; el despacho la lee con el rol de la
// aplicación y el tenant del evento.
//
// - barberias_app: SELECT, INSERT, UPDATE de las columnas del despacho y DELETE solo para la purga de
//   retención de 30 días (decisión del responsable, 2026-11-06), barbería por barbería y con RLS.
// - barberias_plataforma: SELECT de cinco columnas técnicas, con la política plataforma_lectura, para que la
//   tarea despachar-eventos liste los pendientes de todas las barberías (constitución 1.4.1, tercera
//   excepción). Nunca el tipo ni el payload.

/** SELECT por columna de barberias_plataforma (lista cerrada; la compara lectura-plataforma.spec.ts). */
export const COLUMNAS_PLATAFORMA_EVENTOS: Record<string, readonly string[]> = {
  outbox_event: ['id', 'tenant_id', 'status', 'available_at', 'next_attempt_at'],
};

export const UPDATE_APP_EVENTOS = ['status', 'attempts', 'next_attempt_at', 'processed_at'] as const;

export const ESTADOS_EVENTO = ['PENDIENTE', 'PROCESADO', 'ANULADO', 'SIN_MANEJADOR'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE outbox_event (
      id               uuid PRIMARY KEY,
      tenant_id        uuid         NOT NULL REFERENCES tenant (id),
      type             varchar(48)  NOT NULL CHECK (type ~ '^[A-Za-z][A-Za-z0-9]{2,47}$'),
      payload          jsonb        NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      replace_key      varchar(96)  CHECK (replace_key IS NULL OR char_length(replace_key) BETWEEN 3 AND 96),
      available_at     timestamptz  NOT NULL DEFAULT now(),
      status           varchar(14)  NOT NULL DEFAULT 'PENDIENTE'
                                    CHECK (status IN (${ESTADOS_EVENTO.map((e) => `'${e}'`).join(', ')})),
      attempts         smallint     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at  timestamptz,
      created_at       timestamptz  NOT NULL DEFAULT now(),
      processed_at     timestamptz,
      UNIQUE (tenant_id, id),
      -- Los tres estados finales llevan su fecha; el pendiente, no (la purga se guía por processed_at).
      CONSTRAINT outbox_event_fin CHECK ((status = 'PENDIENTE') = (processed_at IS NULL))
    );

    -- Despacho: los pendientes por orden de disponibilidad.
    CREATE INDEX outbox_event_pendientes ON outbox_event (available_at) WHERE status = 'PENDIENTE';
    -- Un solo pendiente por clave de reemplazo en cada barbería (recordatorio de una cita).
    CREATE UNIQUE INDEX outbox_event_clave_pendiente ON outbox_event (tenant_id, replace_key)
      WHERE status = 'PENDIENTE' AND replace_key IS NOT NULL;
    -- El aviso de prueba por terminar, una vez por prueba, cualquiera sea su estado (FR-037).
    CREATE UNIQUE INDEX outbox_event_prueba_una_vez ON outbox_event (tenant_id, replace_key)
      WHERE replace_key LIKE 'prueba-por-terminar:%';
    -- Purga de retención: finales por fecha de fin.
    CREATE INDEX outbox_event_finales ON outbox_event (tenant_id, processed_at) WHERE status <> 'PENDIENTE';

    ${rlsPorTenant('outbox_event')}
    CREATE POLICY plataforma_lectura ON outbox_event FOR SELECT TO barberias_plataforma USING (true);

    GRANT SELECT, INSERT, DELETE ON outbox_event TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_EVENTOS.join(', ')}) ON outbox_event TO barberias_app;
    GRANT SELECT (${COLUMNAS_PLATAFORMA_EVENTOS.outbox_event.join(', ')}) ON outbox_event TO barberias_plataforma;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS outbox_event;`).execute(db);
}
