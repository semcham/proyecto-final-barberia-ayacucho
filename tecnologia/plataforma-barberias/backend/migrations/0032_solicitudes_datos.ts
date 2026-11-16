import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T008 de 007 · Solicitudes sobre datos personales (US1; data-model §1 de 007; RF32, FR-001 a FR-011).
//
// - data_subject_request: una solicitud de un titular (cliente o barbero) sobre sus datos en UNA barbería. Es un dato
//   de la barbería: tenant_id, RLS forzada y claves foráneas compuestas (el titular es de la misma barbería).
// - Una abierta por titular y tipo: índice único parcial (FR-011); el 409 se traduce desde su violación.
// - El texto (detalle, respuesta, motivo) vive solo aquí, con su aislamiento: nunca se copia a la auditoría.
// - barberias_app: SELECT, INSERT y UPDATE solo de las columnas de la transición. Sin DELETE (la atención es manual
//   y el sistema no borra nada, FR-008).
// - Ningún permiso para barberias_auth, barberias_publico ni barberias_plataforma: el administrador de la plataforma
//   nunca llega a las solicitudes (FR-006).

export const TIPOS_SOLICITUD = ['ACCESO', 'RECTIFICACION', 'ELIMINACION'] as const;
export const ESTADOS_SOLICITUD = ['RECIBIDA', 'EN_ATENCION', 'ATENDIDA', 'RECHAZADA'] as const;
export const UPDATE_APP_SOLICITUD = [
  'status',
  'response',
  'rejection_reason',
  'started_at',
  'closed_at',
  'closed_by',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE data_subject_request (
      id                   uuid PRIMARY KEY,
      tenant_id            uuid          NOT NULL REFERENCES tenant (id),
      kind                 varchar(16)   NOT NULL CHECK (kind IN (${lista(TIPOS_SOLICITUD)})),
      subject_kind         varchar(8)    NOT NULL CHECK (subject_kind IN ('CLIENTE', 'BARBERO')),
      customer_id          uuid,
      staff_membership_id  uuid,
      status               varchar(12)   NOT NULL CHECK (status IN (${lista(ESTADOS_SOLICITUD)})),
      detail               varchar(500),
      response             varchar(1000),
      rejection_reason     varchar(300),
      registered_by        uuid          NOT NULL,
      on_behalf            boolean       NOT NULL,
      received_at          timestamptz   NOT NULL DEFAULT now(),
      due_on               date          NOT NULL,
      started_at           timestamptz,
      closed_at            timestamptz,
      closed_by            uuid,
      UNIQUE (tenant_id, id),
      FOREIGN KEY (tenant_id, customer_id) REFERENCES customer_profile (tenant_id, id),
      FOREIGN KEY (tenant_id, staff_membership_id) REFERENCES membership (tenant_id, id),
      -- El titular: un cliente o un barbero, nunca los dos ni ninguno.
      CONSTRAINT data_subject_request_titular CHECK (
        (subject_kind = 'CLIENTE' AND customer_id IS NOT NULL AND staff_membership_id IS NULL)
        OR (subject_kind = 'BARBERO' AND staff_membership_id IS NOT NULL AND customer_id IS NULL)
      ),
      CONSTRAINT data_subject_request_detalle CHECK (
        kind <> 'RECTIFICACION' OR char_length(btrim(coalesce(detail, ''))) > 0
      ),
      CONSTRAINT data_subject_request_respuesta CHECK (
        status <> 'ATENDIDA' OR char_length(btrim(coalesce(response, ''))) > 0
      ),
      CONSTRAINT data_subject_request_motivo CHECK (
        (status = 'RECHAZADA') = (rejection_reason IS NOT NULL)
        AND (rejection_reason IS NULL OR char_length(btrim(rejection_reason)) BETWEEN 5 AND 300)
      ),
      CONSTRAINT data_subject_request_cierre CHECK (
        (status IN ('ATENDIDA', 'RECHAZADA')) = (closed_at IS NOT NULL)
      )
    );
    -- Una abierta por titular y tipo en la barbería (FR-011).
    CREATE UNIQUE INDEX data_subject_request_una_abierta
      ON data_subject_request (tenant_id, kind, coalesce(customer_id, staff_membership_id))
      WHERE status IN ('RECIBIDA', 'EN_ATENCION');
    -- La bandeja del propietario.
    CREATE INDEX data_subject_request_bandeja ON data_subject_request (tenant_id, status, due_on);

    ${rlsPorTenant('data_subject_request')}

    GRANT SELECT, INSERT ON data_subject_request TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_SOLICITUD.join(', ')}) ON data_subject_request TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS data_subject_request;`).execute(db);
}
