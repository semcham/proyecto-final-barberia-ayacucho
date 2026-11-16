import { v7 as uuidv7 } from 'uuid';
import type { AppDePrueba } from './app';
import { poolDe } from './test-db';

// 007 (fase 1, US1): ayudas de las pruebas de las solicitudes sobre datos personales
// (specs/007-indicadores-datos-personales/contracts/openapi.yaml).

const BASE = '/api/v1/datos-personales/solicitudes';

function conToken<T extends { set: (nombre: string, valor: string) => T }>(
  solicitud: T,
  token: string | null,
): T {
  return token ? solicitud.set('Authorization', `Bearer ${token}`) : solicitud;
}

/** POST /datos-personales/solicitudes: el cliente o el barbero, sobre sus propios datos. */
export function registrarSolicitud(
  prueba: AppDePrueba,
  token: string | null,
  cuerpo: Record<string, unknown>,
) {
  return conToken(prueba.agente.post(BASE), token).send(cuerpo);
}

/** POST /datos-personales/solicitudes/en-nombre: el propietario, por un cliente de su barbería. */
export function registrarEnNombre(
  prueba: AppDePrueba,
  token: string | null,
  cuerpo: Record<string, unknown>,
) {
  return conToken(prueba.agente.post(`${BASE}/en-nombre`), token).send(cuerpo);
}

/** GET /datos-personales/solicitudes/mias. */
export function misSolicitudes(prueba: AppDePrueba, token: string | null) {
  return conToken(prueba.agente.get(`${BASE}/mias`), token);
}

/** GET /datos-personales/solicitudes (bandeja del propietario), con el filtro de estado si se pasa. */
export function bandeja(prueba: AppDePrueba, token: string | null, estado?: string) {
  return conToken(prueba.agente.get(`${BASE}${estado ? `?estado=${estado}` : ''}`), token);
}

/** POST /datos-personales/solicitudes/{id}/atencion. */
export function iniciarAtencion(prueba: AppDePrueba, token: string | null, id: string) {
  return conToken(prueba.agente.post(`${BASE}/${id}/atencion`), token).send({});
}

/** POST /datos-personales/solicitudes/{id}/cierre. */
export function cerrarSolicitud(
  prueba: AppDePrueba,
  token: string | null,
  id: string,
  cuerpo: Record<string, unknown>,
) {
  return conToken(prueba.agente.post(`${BASE}/${id}/cierre`), token).send(cuerpo);
}

/** Tablas nuevas de 007 con barbería (data-model §1 de 007): con RLS por tenant. */
export const TABLAS_007_CON_BARBERIA = ['data_subject_request'] as const;

/**
 * Una solicitud sembrada sin RLS (pool "seed"), RECIBIDA por defecto. El titular es un cliente (`clienteId`) o un
 * barbero (`membresiaId`). Sirve para las pruebas de aislamiento y de RLS (T004 de 007).
 */
export async function sembrarSolicitudDatos(opciones: {
  tenantId: string;
  registradaPor: string;
  clienteId?: string;
  membresiaId?: string;
  tipo?: 'ACCESO' | 'RECTIFICACION' | 'ELIMINACION';
  estado?: 'RECIBIDA' | 'EN_ATENCION' | 'ATENDIDA' | 'RECHAZADA';
  detalle?: string | null;
  venceEl?: string;
}): Promise<string> {
  const id = uuidv7();
  const estado = opciones.estado ?? 'RECIBIDA';
  const tipo = opciones.tipo ?? 'ACCESO';
  const cerrada = estado === 'ATENDIDA' || estado === 'RECHAZADA';
  await poolDe('seed').query(
    `INSERT INTO data_subject_request
       (id, tenant_id, kind, subject_kind, customer_id, staff_membership_id, status, detail, response,
        rejection_reason, registered_by, on_behalf, received_at, due_on, started_at, closed_at, closed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, false, now(), $12, $13, $14, $15)`,
    [
      id,
      opciones.tenantId,
      tipo,
      opciones.membresiaId ? 'BARBERO' : 'CLIENTE',
      opciones.membresiaId ? null : (opciones.clienteId ?? null),
      opciones.membresiaId ?? null,
      estado,
      opciones.detalle ?? (tipo === 'RECTIFICACION' ? 'Corregir el teléfono' : null),
      estado === 'ATENDIDA' ? 'Atendida a mano' : null,
      estado === 'RECHAZADA' ? 'No corresponde' : null,
      opciones.registradaPor,
      opciones.venceEl ?? '2026-12-01',
      estado === 'EN_ATENCION' ? new Date() : null,
      cerrada ? new Date() : null,
      cerrada ? opciones.registradaPor : null,
    ],
  );
  return id;
}

/** Id de la membresía de un usuario en una barbería (leída sin RLS). */
export async function membresiaDe(tenantId: string, usuarioId: string): Promise<string> {
  const { rows } = await poolDe('seed').query<{ id: string }>(
    'SELECT id FROM membership WHERE tenant_id = $1 AND user_id = $2',
    [tenantId, usuarioId],
  );
  return rows[0].id;
}

/** Filas de data_subject_request de una barbería, leídas sin RLS, de la más antigua a la más reciente. */
export async function solicitudesDe(tenantId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    'SELECT * FROM data_subject_request WHERE tenant_id = $1 ORDER BY received_at, id',
    [tenantId],
  );
  return rows;
}

/** Fija el estado de la suscripción de una barbería (sin pasar por los casos de uso), como en restricciones-estado. */
export async function fijarEstadoSuscripcion(
  tenantId: string,
  estado: 'TRIAL' | 'ACTIVE' | 'PAST_DUE' | 'EXPIRED' | 'SUSPENDED',
): Promise<void> {
  await poolDe('seed').query(
    `UPDATE subscription
        SET status = $2::text,
            grace_ends_at = CASE WHEN $2::text = 'PAST_DUE' THEN now() + interval '3 days' END,
            suspended_at = CASE WHEN $2::text = 'SUSPENDED' THEN now() END,
            suspension_reason = CASE WHEN $2::text = 'SUSPENDED' THEN 'Revisión de la cuenta' END
      WHERE tenant_id = $1`,
    [tenantId, estado],
  );
}
