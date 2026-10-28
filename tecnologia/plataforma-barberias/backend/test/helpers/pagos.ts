import { randomUUID } from 'node:crypto';
import { firmar } from '../../simulador-pagos/firma';
import type { Simulador } from '../../simulador-pagos/servidor';
import { type AppDePrueba, crearApp } from './app';
import { sembrarBarberia, sembrarSuscripcion } from './fixtures';
import { tokenPara } from './sesiones';
import { iniciarSimuladorDePrueba } from './simulador';
import { poolDe } from './test-db';

// Ayudantes de las pruebas de 003: la aplicación escuchando en un puerto (para que el simulador le notifique
// por HTTP, como un proveedor real), barberías en prueba con su propietario y notificaciones firmadas.

export const PLAN_BASICO = '01923a00-0000-7000-8000-000000000002';
export const PLAN_PRO = '01923a00-0000-7000-8000-000000000003';
export const RUTA_NOTIFICACIONES = '/api/v1/pagos/notificaciones';
const DIA_MS = 24 * 60 * 60 * 1000;

export interface EntornoDePagos {
  prueba: AppDePrueba;
  simulador: Simulador;
  cerrar(): Promise<void>;
}

/** Simulador en el proceso + aplicación escuchando, con el simulador notificando a esa aplicación. */
export async function iniciarEntornoDePagos(
  opciones: {
    entorno?: Record<string, string | undefined>;
    ajustar?: NonNullable<Parameters<typeof crearApp>[0]>['ajustar'];
  } = {},
): Promise<EntornoDePagos> {
  const simulador = await iniciarSimuladorDePrueba();
  const prueba = await crearApp({ escuchar: true, entorno: opciones.entorno, ajustar: opciones.ajustar });
  simulador.cambiarDestino(`${prueba.url}${RUTA_NOTIFICACIONES}`);
  return {
    prueba,
    simulador,
    cerrar: async () => {
      await simulador.cerrar();
      await prueba.cerrar();
    },
  };
}

export interface BarberiaEnPrueba {
  tenantId: string;
  slug: string;
  suscripcionId: string;
  propietarioId: string;
  token: string;
  finPrueba: Date;
}

/** Barbería con su propietario y su suscripción de prueba (14 días por defecto). */
export async function barberiaEnPrueba(diasDePrueba = 14): Promise<BarberiaEnPrueba> {
  const barberia = await sembrarBarberia();
  const finPrueba = new Date(Math.floor(Date.now() / 1000) * 1000 + diasDePrueba * DIA_MS);
  const { suscripcionId } = await sembrarSuscripcion({ tenantId: barberia.tenantId, trialEndsAt: finPrueba });
  return {
    tenantId: barberia.tenantId,
    slug: barberia.slug,
    suscripcionId,
    propietarioId: barberia.propietarioId,
    token: await tokenPara(barberia.tenantId, barberia.propietarioId, 'PROPIETARIO'),
    finPrueba,
  };
}

/** POST /suscripcion/pagos con Yape. */
export function pagarConYape(prueba: AppDePrueba, token: string, planId = PLAN_BASICO) {
  return prueba.agente
    .post('/api/v1/suscripcion/pagos')
    .set('Authorization', `Bearer ${token}`)
    .send({ planId, medio: 'YAPE' });
}

/** Fila del pago tal como está en la base (superusuario de las pruebas, sin RLS). */
export async function filaDePago(pagoId: string): Promise<Record<string, unknown>> {
  const { rows } = await poolDe('seed').query('SELECT * FROM payment WHERE id = $1', [pagoId]);
  return rows[0];
}

export async function periodosDe(
  suscripcionId: string,
): Promise<{ starts_at: Date; ends_at: Date; payment_id: string }[]> {
  const { rows } = await poolDe('seed').query(
    'SELECT starts_at, ends_at, payment_id FROM subscription_period WHERE subscription_id = $1 ORDER BY starts_at',
    [suscripcionId],
  );
  return rows;
}

/** Espera hasta que `condicion` devuelva true (las notificaciones del simulador llegan por HTTP). */
export async function esperarHasta(condicion: () => Promise<boolean>, maximoMs = 10_000): Promise<void> {
  const limite = Date.now() + maximoMs;
  while (Date.now() < limite) {
    if (await condicion()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`La condición no se cumplió en ${maximoMs} ms`);
}

export interface DatosNotificacion {
  referencia: string;
  estado?: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE' | 'EXPIRADO' | 'DEVUELTO';
  importeCentimos?: number;
  eventoId?: string;
  /** Marca de tiempo de la firma, en segundos (ahora por defecto). */
  t?: number;
  secreto?: string;
  extra?: Record<string, unknown>;
}

/** Cuerpo y encabezado de una notificación firmada como la del simulador (contracts/pasarela-simulada.md §4). */
export function notificacionFirmada(datos: DatosNotificacion): {
  cuerpo: string;
  firma: string;
  eventoId: string;
} {
  const eventoId = datos.eventoId ?? `evt_${randomUUID().replace(/-/g, '')}`;
  const cuerpo = JSON.stringify({
    evento_id: eventoId,
    tipo: datos.estado === 'DEVUELTO' ? 'pago.devuelto' : 'pago.actualizado',
    referencia: datos.referencia,
    estado: datos.estado ?? 'APROBADO',
    importe_centimos: datos.importeCentimos ?? 4900,
    moneda: 'PEN',
    emitido_en: new Date().toISOString(),
    ...datos.extra,
  });
  const t = datos.t ?? Math.floor(Date.now() / 1000);
  return {
    cuerpo,
    firma: firmar(datos.secreto ?? (process.env.PAGOS_SECRETO_FIRMA as string), cuerpo, t),
    eventoId,
  };
}

/** Envía una notificación firmada a la aplicación, como lo haría el proveedor. */
export function notificar(prueba: AppDePrueba, datos: DatosNotificacion) {
  const { cuerpo, firma } = notificacionFirmada(datos);
  return prueba.agente
    .post(RUTA_NOTIFICACIONES)
    .set('Content-Type', 'application/json')
    .set('X-Firma', firma)
    .send(cuerpo);
}
