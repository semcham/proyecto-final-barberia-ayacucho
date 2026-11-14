import { createHash, randomBytes } from 'node:crypto';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { v7 as uuidv7 } from 'uuid';
import { Clock } from '../../src/shared';
import type { AppDePrueba } from './app';
import { png } from './comprobantes';
import { nuevaClave } from './reservas';
import { poolDe } from './test-db';

// Ayudantes de las pruebas de 008 (adelanto de reserva con QR): las llamadas a las rutas de configuración, de la
// reserva y del pago, el adelanto activado sembrándolo y lo que quedó en la base, leído sin RLS con el
// superusuario de las pruebas.

const como = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {});

/** Lee el cuerpo de una respuesta binaria (QR o captura) como Buffer. */
function comoBuffer<T extends { buffer(v: boolean): T; parse(fn: unknown): T }>(solicitud: T): T {
  return solicitud
    .buffer(true)
    .parse((respuesta: NodeJS.ReadableStream, listo: (error: null, cuerpo: Buffer) => void) => {
      const partes: Buffer[] = [];
      respuesta.on('data', (parte: Buffer) => partes.push(parte));
      respuesta.on('end', () => listo(null, Buffer.concat(partes)));
    });
}

/** GET /barberia/adelanto. */
export function verConfiguracion(prueba: AppDePrueba, token: string | null) {
  return prueba.agente.get('/api/v1/barberia/adelanto').set(como(token));
}

/** PUT /barberia/adelanto con el cuerpo tal cual. */
export function cambiarConfiguracion(prueba: AppDePrueba, token: string | null, cuerpo: object) {
  return prueba.agente.put('/api/v1/barberia/adelanto').set(como(token)).send(cuerpo);
}

/** PUT /barberia/adelanto/qr (multipart, campo "archivo"). El nombre del archivo no cuenta: mandan los bytes. */
export function subirQr(prueba: AppDePrueba, token: string | null, archivo: Buffer, nombre = 'qr-yape.png') {
  return prueba.agente
    .put('/api/v1/barberia/adelanto/qr')
    .set(como(token))
    .attach('archivo', archivo, { filename: nombre });
}

/** GET /barberia/adelanto/qr, con el contenido como Buffer. */
export function verQr(prueba: AppDePrueba, token: string | null) {
  return comoBuffer(prueba.agente.get('/api/v1/barberia/adelanto/qr').set(como(token)));
}

/** La fila de booking_deposit_settings de la barbería, o undefined. */
export async function filaConfiguracion(tenantId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await poolDe('seed').query('SELECT * FROM booking_deposit_settings WHERE tenant_id = $1', [
    tenantId,
  ]);
  return rows[0];
}

/** Los archivos del adelanto de la barbería, del más antiguo al más reciente. */
export async function archivosDeAdelanto(tenantId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    `SELECT id, kind, content_type, size_bytes, sha256, content, created_by
       FROM booking_deposit_file WHERE tenant_id = $1 ORDER BY created_at, id`,
    [tenantId],
  );
  return rows;
}

// --- Fase 3 (US2): reserva pendiente y registro del pago ---

export interface AdelantoActivo {
  qrId: string;
  qr: Buffer;
}

/**
 * Activa el adelanto de la barbería sembrándolo (sin pasar por la API de US1): un QR PNG y la configuración. Por
 * defecto, 20 % del precio y 30 minutos para pagar.
 */
export async function activarAdelanto(
  tenantId: string,
  propietarioId: string,
  regla:
    | { tipo: 'PORCENTAJE'; porcentaje: number; plazoMinutos?: number }
    | { tipo: 'FIJO'; montoCentimos: number; plazoMinutos?: number } = { tipo: 'PORCENTAJE', porcentaje: 20 },
): Promise<AdelantoActivo> {
  const seed = poolDe('seed');
  const qr = png();
  const qrId = uuidv7();
  await seed.query(
    `INSERT INTO booking_deposit_file (id, tenant_id, kind, content_type, size_bytes, sha256, content, created_by)
     VALUES ($1, $2, 'QR', 'image/png', $3, $4, $5, $6)`,
    [qrId, tenantId, qr.length, createHash('sha256').update(qr).digest('hex'), qr, propietarioId],
  );
  await seed.query(
    `INSERT INTO booking_deposit_settings (tenant_id, enabled, kind, amount_cents, percent, payment_window_minutes,
       qr_file_id, updated_by)
     VALUES ($1, true, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (tenant_id) DO UPDATE SET enabled = true, kind = EXCLUDED.kind, amount_cents = EXCLUDED.amount_cents,
       percent = EXCLUDED.percent, payment_window_minutes = EXCLUDED.payment_window_minutes,
       qr_file_id = EXCLUDED.qr_file_id`,
    [
      tenantId,
      regla.tipo,
      regla.tipo === 'FIJO' ? regla.montoCentimos : null,
      regla.tipo === 'PORCENTAJE' ? regla.porcentaje : null,
      regla.plazoMinutos ?? 30,
      qrId,
      propietarioId,
    ],
  );
  return { qrId, qr };
}

/** POST /citas con su Idempotency-Key (nueva por defecto). */
export function reservar(
  prueba: AppDePrueba,
  token: string | null,
  cuerpo: { servicioId: string; barberoId: string; inicio: string; clienteId?: string },
  clave = nuevaClave(),
) {
  return prueba.agente
    .post('/api/v1/citas')
    .set({ ...como(token), 'Idempotency-Key': clave })
    .send(cuerpo);
}

/** Número de operación único para la prueba (4 a 20 alfanuméricos). */
export const numeroDeOperacion = (): string => `OP${randomBytes(5).toString('hex').toUpperCase()}`;

/** POST /citas/{id}/adelanto/pago (multipart): el número y, si viene, la captura. */
export function registrarPago(
  prueba: AppDePrueba,
  token: string | null,
  citaId: string,
  datos: { numero?: string; captura?: Buffer; nombre?: string } = {},
) {
  let solicitud = prueba.agente.post(`/api/v1/citas/${citaId}/adelanto/pago`).set(como(token));
  if (datos.captura) {
    solicitud = solicitud.attach('archivo', datos.captura, { filename: datos.nombre ?? 'captura.png' });
  }
  return solicitud.field('numeroOperacion', datos.numero ?? numeroDeOperacion());
}

/** GET /citas/{id}/adelanto. */
export function verAdelanto(prueba: AppDePrueba, token: string | null, citaId: string) {
  return prueba.agente.get(`/api/v1/citas/${citaId}/adelanto`).set(como(token));
}

/** GET /citas/{id}/adelanto/qr, con el contenido como Buffer. */
export function verQrDeCita(prueba: AppDePrueba, token: string | null, citaId: string) {
  return comoBuffer(prueba.agente.get(`/api/v1/citas/${citaId}/adelanto/qr`).set(como(token)));
}

/** GET /citas/{id}/adelanto/captura, con el contenido como Buffer. */
export function verCaptura(prueba: AppDePrueba, token: string | null, citaId: string) {
  return comoBuffer(prueba.agente.get(`/api/v1/citas/${citaId}/adelanto/captura`).set(como(token)));
}

/** La fila de booking_deposit de la cita, o undefined. */
export async function filaAdelanto(citaId: string): Promise<Record<string, unknown> | undefined> {
  const { rows } = await poolDe('seed').query('SELECT * FROM booking_deposit WHERE appointment_id = $1', [
    citaId,
  ]);
  return rows[0];
}

/** Los registros de pago del adelanto de la cita, del más antiguo al más reciente. */
export async function pagosDeAdelanto(citaId: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    `SELECT p.* FROM booking_deposit_payment p JOIN booking_deposit d ON d.id = p.deposit_id
      WHERE d.appointment_id = $1 ORDER BY p.registered_at, p.id`,
    [citaId],
  );
  return rows;
}

/** Los eventos de la salida de la barbería, por tipo (sin RLS). */
export async function eventosDe(tenantId: string, tipo: string): Promise<Record<string, unknown>[]> {
  const { rows } = await poolDe('seed').query(
    'SELECT id, type, payload, available_at, status FROM outbox_event WHERE tenant_id = $1 AND type = $2',
    [tenantId, tipo],
  );
  return rows;
}

// --- Fase 4 (US3): confirmar y rechazar el pago ---

/** POST /citas/{id}/adelanto/confirmacion. */
export function confirmarAdelanto(prueba: AppDePrueba, token: string | null, citaId: string) {
  return prueba.agente.post(`/api/v1/citas/${citaId}/adelanto/confirmacion`).set(como(token)).send({});
}

/** POST /citas/{id}/adelanto/rechazo con el motivo (sin cuerpo si `motivo` es undefined). */
export function rechazarPago(prueba: AppDePrueba, token: string | null, citaId: string, motivo?: string) {
  return prueba.agente
    .post(`/api/v1/citas/${citaId}/adelanto/rechazo`)
    .set(como(token))
    .send(motivo === undefined ? {} : { motivo });
}

/** GET /adelantos/por-revisar (con el estado de la bandeja si se indica). */
export function bandejaDeAdelantos(prueba: AppDePrueba, token: string | null, estado?: string) {
  return prueba.agente
    .get(`/api/v1/adelantos/por-revisar${estado ? `?estado=${estado}` : ''}`)
    .set(como(token));
}

/** POST /citas/{id}/estado (002). */
export function cambiarEstadoCita(prueba: AppDePrueba, token: string | null, citaId: string, estado: string) {
  return prueba.agente.post(`/api/v1/citas/${citaId}/estado`).set(como(token)).send({ estado });
}

// --- Fase 6 (US5): cancelar, no asistió, reprogramar y marcar devuelto ---

/** POST /citas/{id}/cancelar (002), con el motivo si se indica. */
export function cancelarCita(prueba: AppDePrueba, token: string | null, citaId: string, motivo?: string) {
  return prueba.agente
    .post(`/api/v1/citas/${citaId}/cancelar`)
    .set(como(token))
    .send(motivo === undefined ? {} : { motivo });
}

/** POST /citas/{id}/reprogramar (004). */
export function reprogramarCita(
  prueba: AppDePrueba,
  token: string | null,
  citaId: string,
  cuerpo: { inicio: string; barberoId?: string },
) {
  return prueba.agente.post(`/api/v1/citas/${citaId}/reprogramar`).set(como(token)).send(cuerpo);
}

/** POST /citas/{id}/adelanto/devolucion. */
export function marcarDevuelto(prueba: AppDePrueba, token: string | null, citaId: string) {
  return prueba.agente.post(`/api/v1/citas/${citaId}/adelanto/devolucion`).set(como(token)).send({});
}

/**
 * Adelanto de una cita ya sembrada, sembrado sin pasar por la API (para las pruebas que no prueban la reserva):
 * POR_PAGAR, o POR_REVISAR con un registro de pago vigente. Usa el QR de la configuración de la barbería si existe;
 * si no, siembra uno.
 */
export async function sembrarAdelanto(opciones: {
  tenantId: string;
  citaId: string;
  clienteId: string;
  usuarioClienteId: string;
  propietarioId: string;
  estado?: 'POR_PAGAR' | 'POR_REVISAR';
  montoCentimos?: number;
}): Promise<{ adelantoId: string; codigo: string; numero: string | null }> {
  const seed = poolDe('seed');
  let { rows } = await seed.query<{ qr_file_id: string }>(
    'SELECT qr_file_id FROM booking_deposit_settings WHERE tenant_id = $1 AND qr_file_id IS NOT NULL',
    [opciones.tenantId],
  );
  if (rows.length === 0) {
    await activarAdelanto(opciones.tenantId, opciones.propietarioId);
    ({ rows } = await seed.query<{ qr_file_id: string }>(
      'SELECT qr_file_id FROM booking_deposit_settings WHERE tenant_id = $1',
      [opciones.tenantId],
    ));
  }
  const adelantoId = uuidv7();
  const codigo = Array.from(randomBytes(6), (b) => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[b % 31]).join('');
  const estado = opciones.estado ?? 'POR_REVISAR';
  await seed.query(
    `INSERT INTO booking_deposit (id, tenant_id, appointment_id, customer_id, customer_user_id, code, amount_cents,
       service_price_cents, service_name, starts_at, time_zone, qr_file_id, due_at, review_limit_at, status)
     SELECT $1, $2, a.id, $3, $4, $5, $6, 2000, a.service_name, a.starts_at, 'America/Lima', $7,
            now() + interval '30 minutes', now() + interval '1 day', $8
       FROM appointment a WHERE a.id = $9`,
    [
      adelantoId,
      opciones.tenantId,
      opciones.clienteId,
      opciones.usuarioClienteId,
      codigo,
      opciones.montoCentimos ?? 400,
      rows[0].qr_file_id,
      estado,
      opciones.citaId,
    ],
  );
  let numero: string | null = null;
  if (estado === 'POR_REVISAR') {
    numero = numeroDeOperacion();
    await seed.query(
      `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, registered_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [uuidv7(), opciones.tenantId, adelantoId, numero, opciones.usuarioClienteId],
    );
  }
  return { adelantoId, codigo, numero };
}

/** Un reloj que la prueba mueve: empieza en el instante real y `fijar` o `avanzar` lo cambian. */
export class RelojDePrueba extends Clock {
  private desplazamientoMs = 0;

  ahora(): Date {
    return new Date(Date.now() + this.desplazamientoMs);
  }

  /** Lleva el reloj al instante dado (y sigue corriendo desde ahí). */
  fijar(instante: Date): void {
    this.desplazamientoMs = instante.getTime() - Date.now();
  }

  avanzar(ms: number): void {
    this.desplazamientoMs += ms;
  }

  real(): void {
    this.desplazamientoMs = 0;
  }
}

/** Para `crearApp({ ajustar })`: la aplicación usa el reloj de la prueba. */
export const conReloj = (reloj: RelojDePrueba) => (constructor: TestingModuleBuilder) =>
  constructor.overrideProvider(Clock).useValue(reloj);
