import { AIProvider } from '../../src/modules/asistente-reportes/asistente/application/ports/ai-provider';
import { ProveedorIAFalso } from '../../src/modules/asistente-reportes/asistente/infrastructure/proveedor-ia-falso';
import type { AppDePrueba } from './app';
import { sembrarCliente, sembrarServicio } from './fixtures';
import { type BarberiaParaReservar, barberiaParaReservar } from './reservas';
import { tokenPara } from './sesiones';
import { poolDe } from './test-db';

// 005 (fase 3, US1): ayudas de las pruebas del asistente (POST /asistente/mensajes), siempre con el proveedor FALSO.

/** Cuotas altas para las pruebas que no prueban la cuota (PR19 hace 24 preguntas del mismo cliente). */
export const ENTORNO_SIN_LIMITE = {
  IA_PROVEEDOR: 'falso',
  IA_CUOTA_USUARIO_DIA: '1000',
  IA_CUOTA_BARBERIA_DIA: '100000',
};

export interface Intervencion {
  de: string;
  texto: string;
}

/** POST /api/v1/asistente/mensajes con el token dado (o sin sesión) y el cuerpo tal cual. */
export function preguntar(
  prueba: AppDePrueba,
  token: string | null,
  mensaje: unknown,
  contexto?: Intervencion[],
  extra: Record<string, unknown> = {},
) {
  const solicitud = prueba.agente.post('/api/v1/asistente/mensajes');
  if (token) solicitud.set('Authorization', `Bearer ${token}`);
  return solicitud.send({ mensaje, ...(contexto ? { contexto } : {}), ...extra });
}

/** El proveedor falso de la aplicación (IA_PROVEEDOR=falso), para fijar sus modos y leer lo que recibió. */
export function falsoDe(prueba: AppDePrueba): ProveedorIAFalso {
  const proveedor = prueba.app.get(AIProvider, { strict: false });
  if (!(proveedor instanceof ProveedorIAFalso)) throw new Error('La aplicación no usa el proveedor falso');
  return proveedor;
}

export interface BarberiaDelAsistente {
  e: BarberiaParaReservar;
  tenantId: string;
  slug: string;
  nombre: string;
  /** Corte clásico (el servicio de barberiaParaReservar, renombrado) y Barba. */
  corte: string;
  barba: string;
  luis: string;
  ana: string;
  cliente: { token: string; usuarioId: string; clienteId: string };
  propietario: string;
}

/**
 * Barbería con horario todos los días, "Corte clásico" (30 min) y "Barba", y dos barberos (Luis y Ana) que hacen el
 * corte; solo Luis hace la barba. Un cliente con cuenta y su token, y el token del propietario.
 */
export async function barberiaDelAsistente(prefijo = ''): Promise<BarberiaDelAsistente> {
  const e = await barberiaParaReservar();
  const tenantId = e.barberia.tenantId;
  const seed = poolDe('seed');
  await seed.query(`UPDATE service SET name = $2, price = '25.00' WHERE id = $1`, [
    e.servicioId,
    `${prefijo}Corte clásico`,
  ]);
  await seed.query(`UPDATE barber SET display_name = $2 WHERE id = $1`, [e.barberoId, `${prefijo}Luis`]);
  await seed.query(`UPDATE barber SET display_name = $2 WHERE id = $1`, [e.otroBarberoId, `${prefijo}Ana`]);
  const barba = (
    await sembrarServicio({ tenantId, nombre: `${prefijo}Barba`, precio: '15.50', duracionMin: 20 })
  ).servicioId;
  await seed.query('INSERT INTO barber_service (tenant_id, barber_id, service_id) VALUES ($1, $2, $3)', [
    tenantId,
    e.barberoId,
    barba,
  ]);
  const { rows } = await seed.query<{ name: string }>('SELECT name FROM tenant WHERE id = $1', [tenantId]);
  const cliente = await sembrarCliente({ tenantId });
  return {
    e,
    tenantId,
    slug: e.barberia.slug,
    nombre: rows[0].name,
    corte: e.servicioId,
    barba,
    luis: e.barberoId,
    ana: e.otroBarberoId,
    cliente: {
      token: await tokenPara(tenantId, cliente.usuarioId as string, 'CLIENTE'),
      usuarioId: cliente.usuarioId as string,
      clienteId: cliente.clienteId,
    },
    propietario: await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO'),
  };
}

/** Filas que ninguna pregunta al asistente puede cambiar (FR-005, PR19: 0 escrituras). */
export async function conteosDeNegocio(): Promise<Record<string, number>> {
  const { rows } = await poolDe('seed').query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM appointment)::int AS citas,
            (SELECT count(*) FROM appointment_status_history)::int AS historial,
            (SELECT count(*) FROM booking_deposit)::int AS adelantos,
            (SELECT count(*) FROM user_account)::int AS usuarios,
            (SELECT count(*) FROM customer_profile)::int AS clientes,
            (SELECT count(*) FROM service)::int AS servicios,
            (SELECT count(*) FROM barber)::int AS barberos,
            (SELECT count(*) FROM time_off)::int AS bloqueos`,
  );
  return rows[0];
}

/** Las preguntas registradas de una barbería, en orden. */
export async function preguntasDe(tenantId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    'SELECT * FROM assistant_question WHERE tenant_id = $1 ORDER BY asked_at, id',
    [tenantId],
  );
  return rows;
}

/** El uso de la cuota de un sujeto en un día (0 si no hay fila). */
export async function usoDeCuota(
  tenantId: string,
  scope: 'USUARIO' | 'BARBERIA',
  sujeto: string,
): Promise<number> {
  const { rows } = await poolDe('seed').query<{ used: number }>(
    'SELECT coalesce(sum(used), 0)::int AS used FROM assistant_quota WHERE tenant_id = $1 AND scope = $2 AND subject_id = $3',
    [tenantId, scope, sujeto],
  );
  return rows[0].used;
}
