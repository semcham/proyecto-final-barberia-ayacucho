import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T022 · Funcionalidad 004: canal de aviso del cliente y consentimiento expreso para WhatsApp (M01, RF33;
// data-model.md §2). Las dos tablas son de barbería, con RLS forzada (principio III).
//
// - customer_notification_preference: una fila por perfil de cliente en una barbería; sin fila, el canal es
//   correo. El número de WhatsApp es un campo propio del cliente (FR-017).
// - whatsapp_consent: la evidencia del consentimiento (versión del texto, número aceptado y fechas), separada
//   de consent_record. Sin DELETE: la evidencia se conserva; el retiro solo fija withdrawn_at (FR-018).

export const UPDATE_APP_PREFERENCIA = ['channel', 'whatsapp_number', 'updated_at'] as const;
export const UPDATE_APP_CONSENTIMIENTO = ['withdrawn_at'] as const;

const NUMERO_WHATSAPP = `'^\\+?[0-9 ]{6,20}$'`;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE customer_notification_preference (
      tenant_id        uuid        NOT NULL REFERENCES tenant (id),
      customer_id      uuid        NOT NULL,
      channel          varchar(10) NOT NULL CHECK (channel IN ('CORREO', 'WHATSAPP')),
      whatsapp_number  varchar(20) CHECK (whatsapp_number IS NULL OR whatsapp_number ~ ${NUMERO_WHATSAPP}),
      updated_at       timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, customer_id),
      FOREIGN KEY (tenant_id, customer_id) REFERENCES customer_profile (tenant_id, id),
      CONSTRAINT customer_notification_preference_numero CHECK (channel <> 'WHATSAPP' OR whatsapp_number IS NOT NULL)
    );

    CREATE TABLE whatsapp_consent (
      id            uuid PRIMARY KEY,
      tenant_id     uuid        NOT NULL REFERENCES tenant (id),
      customer_id   uuid        NOT NULL,
      number        varchar(20) NOT NULL CHECK (number ~ ${NUMERO_WHATSAPP}),
      text_version  varchar(32) NOT NULL CHECK (char_length(btrim(text_version)) BETWEEN 1 AND 32),
      accepted_at   timestamptz NOT NULL DEFAULT now(),
      withdrawn_at  timestamptz,
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, customer_id) REFERENCES customer_profile (tenant_id, id),
      CONSTRAINT whatsapp_consent_retiro CHECK (withdrawn_at IS NULL OR withdrawn_at >= accepted_at)
    );
    -- Como máximo un consentimiento vigente por cliente y barbería.
    CREATE UNIQUE INDEX whatsapp_consent_vigente ON whatsapp_consent (tenant_id, customer_id)
      WHERE withdrawn_at IS NULL;

    ${rlsPorTenant('customer_notification_preference')}
    ${rlsPorTenant('whatsapp_consent')}

    GRANT SELECT, INSERT ON customer_notification_preference TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_PREFERENCIA.join(', ')}) ON customer_notification_preference TO barberias_app;
    GRANT SELECT, INSERT ON whatsapp_consent TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_CONSENTIMIENTO.join(', ')}) ON whatsapp_consent TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(`DROP TABLE IF EXISTS whatsapp_consent; DROP TABLE IF EXISTS customer_notification_preference;`)
    .execute(db);
}
