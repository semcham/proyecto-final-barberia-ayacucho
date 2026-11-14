import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T008 · Funcionalidad 005: las cuotas del asistente y el registro de preguntas sin texto (data-model.md §1, §2 y §5
// de 005; research R08 y R09).
//
// - assistant_quota: una fila por barbería, alcance (USUARIO o BARBERIA), sujeto y día local de la barbería. La
//   suma es atómica con INSERT … ON CONFLICT DO UPDATE … WHERE used < :limite (principio VIII: la cuota de IA vive
//   en PostgreSQL, compartida entre réplicas). Los límites no se guardan: son de la configuración.
// - assistant_question: quién preguntó, cuándo, la intención, el resultado, la duración y los tokens. NO tiene
//   columnas para el texto de la pregunta, de la respuesta ni para los argumentos (FR-010, SC-007).
// - barberias_app: SELECT, INSERT y UPDATE (used, updated_at) en la cuota; SELECT e INSERT en el registro. Sin DELETE.
// - Ningún permiso para barberias_auth, barberias_publico ni barberias_plataforma.

export const ALCANCES_CUOTA = ['USUARIO', 'BARBERIA'] as const;

export const ROLES_ASISTENTE = ['CLIENTE', 'PROPIETARIO'] as const;

/** Intenciones del esquema cerrado (contracts/asistente.md §2 de 005). */
export const INTENCIONES_ASISTENTE = [
  'servicios',
  'barberos',
  'horarios_libres',
  'resumen_citas',
  'servicios_mas_pedidos',
  'fuera_de_alcance',
  'accion_no_permitida',
] as const;

/** Resultados de una pregunta (data-model §2 y §6 de 005). */
export const RESULTADOS_PREGUNTA = [
  'RESPONDIDA',
  'SIN_DATOS',
  'FUERA_DE_ALCANCE',
  'ACCION_NO_PERMITIDA',
  'CUOTA_AGOTADA',
  'PROVEEDOR_NO_DISPONIBLE',
  'INVALIDA',
] as const;

export const UPDATE_APP_CUOTA = ['used', 'updated_at'] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE assistant_quota (
      tenant_id   uuid         NOT NULL REFERENCES tenant (id),
      scope       varchar(8)   NOT NULL CHECK (scope IN (${lista(ALCANCES_CUOTA)})),
      subject_id  uuid         NOT NULL,
      day         date         NOT NULL,
      used        integer      NOT NULL DEFAULT 0 CHECK (used >= 0),
      updated_at  timestamptz  NOT NULL DEFAULT now(),
      PRIMARY KEY (tenant_id, scope, subject_id, day),
      -- La cuota de la barbería tiene como sujeto a la propia barbería (data-model §1).
      CONSTRAINT assistant_quota_sujeto_barberia CHECK (scope <> 'BARBERIA' OR subject_id = tenant_id)
    );

    CREATE TABLE assistant_question (
      id           uuid PRIMARY KEY,
      tenant_id    uuid         NOT NULL REFERENCES tenant (id),
      user_id      uuid         NOT NULL REFERENCES user_account (id),
      role         varchar(12)  NOT NULL CHECK (role IN (${lista(ROLES_ASISTENTE)})),
      asked_at     timestamptz  NOT NULL DEFAULT now(),
      intent       varchar(32)  CHECK (intent IN (${lista(INTENCIONES_ASISTENTE)})),
      result       varchar(24)  NOT NULL CHECK (result IN (${lista(RESULTADOS_PREGUNTA)})),
      duration_ms  integer      NOT NULL CHECK (duration_ms >= 0),
      tokens_in    integer      CHECK (tokens_in >= 0),
      tokens_out   integer      CHECK (tokens_out >= 0),
      UNIQUE (tenant_id, id)
    );
    CREATE INDEX assistant_question_por_fecha ON assistant_question (tenant_id, asked_at DESC);

    ${rlsPorTenant('assistant_quota')}
    ${rlsPorTenant('assistant_question')}

    GRANT SELECT, INSERT ON assistant_quota TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_CUOTA.join(', ')}) ON assistant_quota TO barberias_app;
    GRANT SELECT, INSERT ON assistant_question TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DROP TABLE IF EXISTS assistant_question;
    DROP TABLE IF EXISTS assistant_quota;
  `,
    )
    .execute(db);
}
