import { randomInt } from 'node:crypto';
import { type AccionDeEnlace, EnlacesFirmados } from '../../src/shared/enlaces-firmados';
import type { AppDePrueba } from './app';
import { sembrarCita } from './fixtures';
import type { BarberiaParaReservar } from './reservas';
import { sesionCliente } from './sesiones';
import { poolDe } from './test-db';

// Ayudantes de las pruebas de los enlaces de acción (004, fase 4, US3; contracts/enlaces-de-accion.md).
// Cada prueba usa su propia IP (X-Forwarded-For, que la aplicación acepta desde loopback): el contador de
// rechazos por IP es global (action_link_attempt), y así una prueba no bloquea a otra.

export const RUTA_ENLACES = '/api/v1/enlaces/accion';
const MINUTO = 60_000;

/** Una IP de documentación distinta en cada llamada (198.18.0.0/15, reservada para pruebas). */
export function ipUnica(): string {
  return `198.${18 + randomInt(2)}.${randomInt(256)}.${randomInt(1, 255)}`;
}

/** Emite un enlace como lo haría M05 al enviar el recordatorio (con la llave de la aplicación de prueba). */
export function emitirEnlace(
  prueba: AppDePrueba,
  datos: { tenantId: string; citaId: string; accion: AccionDeEnlace; version?: number; venceEn: Date },
): string {
  return prueba.app.get(EnlacesFirmados).emitir({
    tenantId: datos.tenantId,
    recursoId: datos.citaId,
    accion: datos.accion,
    version: datos.version ?? 1,
    venceEn: datos.venceEn,
  });
}

/** Solicitud a una ruta de enlaces con el token en X-Enlace-Accion (nunca en la URL) y la IP indicada. */
export function solicitudDeEnlace(
  prueba: AppDePrueba,
  accion: 'consultar' | 'confirmar' | 'cancelar' | 'reprogramar',
  token: string,
  ip: string,
  cuerpo?: object,
) {
  const encabezados = { 'X-Enlace-Accion': token, 'X-Forwarded-For': ip };
  if (accion === 'consultar') return prueba.agente.get(RUTA_ENLACES).set(encabezados);
  return prueba.agente
    .post(`${RUTA_ENLACES}/${accion}`)
    .set(encabezados)
    .send(cuerpo ?? {});
}

export interface CitaConEnlaces {
  citaId: string;
  inicio: Date;
  cliente: Awaited<ReturnType<typeof sesionCliente>>;
  enlace: (accion: AccionDeEnlace, version?: number) => string;
}

/** Una cita CONFIRMADA de un cliente con sesión que empieza dentro de `minutos`, con sus enlaces. */
export async function citaConEnlaces(
  prueba: AppDePrueba,
  e: BarberiaParaReservar,
  minutos: number,
  barberoId = e.barberoId,
): Promise<CitaConEnlaces> {
  const cliente = await sesionCliente(e.barberia.tenantId);
  // Al minuto: las citas sembradas no tienen que caer en el paso de la agenda.
  const inicio = new Date(Math.ceil((Date.now() + minutos * MINUTO) / MINUTO) * MINUTO);
  const citaId = await sembrarCita({
    tenantId: e.barberia.tenantId,
    barberoId,
    servicioId: e.servicioId,
    clienteId: cliente.cliente.clienteId,
    inicio,
    creadoPor: cliente.cliente.usuarioId as string,
  });
  return {
    citaId,
    inicio,
    cliente,
    enlace: (accion, version = 1) =>
      emitirEnlace(prueba, { tenantId: e.barberia.tenantId, citaId, accion, version, venceEn: inicio }),
  };
}

export async function filaDeCita(citaId: string) {
  const { rows } = await poolDe('seed').query(
    `SELECT status, version, starts_at, client_confirmed_at, late_cancellation, cancelled_by
       FROM appointment WHERE id = $1`,
    [citaId],
  );
  return rows[0] as {
    status: string;
    version: number;
    starts_at: Date;
    client_confirmed_at: Date | null;
    late_cancellation: boolean;
    cancelled_by: string | null;
  };
}

export async function usosDeEnlace(citaId: string): Promise<{ action: string; link_hash: string }[]> {
  const { rows } = await poolDe('seed').query(
    'SELECT action, link_hash FROM appointment_link_use WHERE appointment_id = $1 ORDER BY used_at',
    [citaId],
  );
  return rows;
}
