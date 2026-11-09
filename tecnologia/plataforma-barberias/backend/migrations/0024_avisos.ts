import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T024 · Funcionalidad 004: avisos de M05 (RF30, RF33, RF34; data-model.md §4).
//
// Un aviso por destinatario de un evento. NO guarda el texto del mensaje ni datos de contacto: se componen al
// enviar, con lo que M05 lee de M01 en ese momento (R12). Tabla de barbería, con RLS forzada (principio III).
//
// - UNIQUE (tenant_id, event_id, recipient_kind, recipient_ref): el mismo evento nunca crea dos avisos para el
//   mismo destinatario (FR-012).
// - barberias_app: SELECT, INSERT y UPDATE de las columnas del envío.
// - barberias_plataforma: SELECT de cinco columnas técnicas, para que la tarea enviar-avisos liste los
//   pendientes de todas las barberías (constitución 1.4.1, tercera excepción).

export const COLUMNAS_PLATAFORMA_AVISOS: Record<string, readonly string[]> = {
  notification: ['id', 'tenant_id', 'status', 'next_attempt_at', 'claimed_until'],
};

export const UPDATE_APP_AVISOS = [
  'channel_used',
  'status',
  'attempts',
  'next_attempt_at',
  'claimed_until',
  'sent_at',
  'last_error',
] as const;

export const TIPOS_DE_AVISO = [
  'CITA_CREADA',
  'CITA_CANCELADA',
  'CITA_REPROGRAMADA',
  'RECORDATORIO',
  'PRUEBA_POR_TERMINAR',
  'SUSCRIPCION_EN_GRACIA',
  'SUSCRIPCION_VENCIDA',
  'PAGO_APROBADO',
  'PAGO_RECHAZADO',
] as const;

export const ESTADOS_AVISO = [
  'PENDIENTE',
  'ENVIANDO',
  'ENVIADO',
  'ENVIADO_RESPALDO',
  'FALLIDO',
  'DESCARTADO',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE notification (
      id               uuid PRIMARY KEY,
      tenant_id        uuid         NOT NULL REFERENCES tenant (id),
      event_id         uuid         NOT NULL,
      kind             varchar(32)  NOT NULL CHECK (kind IN (${lista(TIPOS_DE_AVISO)})),
      recipient_kind   varchar(12)  NOT NULL CHECK (recipient_kind IN ('CLIENTE', 'PROPIETARIO', 'BARBERO')),
      recipient_ref    uuid         NOT NULL,
      appointment_id   uuid,
      channel_planned  varchar(10)  NOT NULL CHECK (channel_planned IN ('CORREO', 'WHATSAPP')),
      channel_used     varchar(10)  CHECK (channel_used IS NULL OR channel_used IN ('CORREO', 'WHATSAPP')),
      status           varchar(18)  NOT NULL DEFAULT 'PENDIENTE' CHECK (status IN (${lista(ESTADOS_AVISO)})),
      attempts         smallint     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
      next_attempt_at  timestamptz,
      claimed_until    timestamptz,
      discard_after    timestamptz  NOT NULL,
      sent_at          timestamptz,
      -- Solo un código del error, nunca el texto del proveedor.
      last_error       varchar(40)  CHECK (last_error IS NULL OR last_error ~ '^[A-Z_]{3,40}$'),
      created_at       timestamptz  NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, id),
      CONSTRAINT notification_un_aviso_por_destinatario UNIQUE (tenant_id, event_id, recipient_kind, recipient_ref)
    );
    -- Envío: los pendientes y los reclamados por orden de próximo intento.
    CREATE INDEX notification_por_enviar ON notification (next_attempt_at) WHERE status IN ('PENDIENTE', 'ENVIANDO');
    -- Descartar los recordatorios pendientes de una cita que cambió (R09).
    CREATE INDEX notification_de_la_cita ON notification (tenant_id, appointment_id) WHERE appointment_id IS NOT NULL;

    ${rlsPorTenant('notification')}
    CREATE POLICY plataforma_lectura ON notification FOR SELECT TO barberias_plataforma USING (true);

    GRANT SELECT, INSERT ON notification TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_AVISOS.join(', ')}) ON notification TO barberias_app;
    GRANT SELECT (${COLUMNAS_PLATAFORMA_AVISOS.notification.join(', ')}) ON notification TO barberias_plataforma;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS notification;`).execute(db);
}
