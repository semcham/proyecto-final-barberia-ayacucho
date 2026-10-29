import { randomBytes } from 'node:crypto';
import { ZonaHoraria } from '../../src/shared';
import type { AppDePrueba } from './app';
import { PLAN_BASICO } from './pagos';

// Ayudantes de US3 (transferencia con comprobante): archivos de prueba con los bytes reales de cada formato,
// la transferencia iniciada por el propietario y la subida multipart.

/** Bytes de un PNG (firma + cabecera IHDR) seguidos de relleno aleatorio: cada llamada da otro SHA-256. */
export function png(relleno = 256): Buffer {
  return Buffer.concat([
    Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    ]),
    randomBytes(relleno),
  ]);
}

export function jpeg(relleno = 256): Buffer {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]),
    randomBytes(relleno),
  ]);
}

export function pdf(relleno = 256): Buffer {
  return Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), randomBytes(relleno)]);
}

/** Hoy en la barbería (America/Lima), AAAA-MM-DD. */
export function hoyEnLima(desplazamientoDias = 0): string {
  return ZonaHoraria.LIMA.fechaDe(new Date(Date.now() + desplazamientoDias * 24 * 60 * 60 * 1000)).toString();
}

/** Número de operación único para la prueba (6 a 40 caracteres alfanuméricos). */
export const numeroOperacion = (): string => `OP${randomBytes(6).toString('hex').toUpperCase()}`;

const como = (token: string) => ({ Authorization: `Bearer ${token}` });

/** POST /suscripcion/pagos con transferencia. */
export function iniciarTransferencia(prueba: AppDePrueba, token: string, planId = PLAN_BASICO) {
  return prueba.agente
    .post('/api/v1/suscripcion/pagos')
    .set(como(token))
    .send({ planId, medio: 'TRANSFERENCIA' });
}

/** POST /suscripcion/pagos/{id}/comprobante (multipart). */
export function subirComprobante(
  prueba: AppDePrueba,
  token: string,
  pagoId: string,
  datos: { archivo?: Buffer; nombre?: string; numero?: string; fecha?: string } = {},
) {
  let solicitud = prueba.agente.post(`/api/v1/suscripcion/pagos/${pagoId}/comprobante`).set(como(token));
  if (datos.archivo !== undefined) {
    solicitud = solicitud.attach('archivo', datos.archivo, { filename: datos.nombre ?? 'comprobante.png' });
  }
  return solicitud
    .field('numeroOperacion', datos.numero ?? numeroOperacion())
    .field('fechaTransferencia', datos.fecha ?? hoyEnLima());
}

/** Transferencia iniciada y con su comprobante subido (pago EN_REVISION). */
export async function pagoEnRevision(
  prueba: AppDePrueba,
  token: string,
  datos: { archivo?: Buffer; numero?: string } = {},
): Promise<{ pagoId: string; numero: string; archivo: Buffer; referencia: string }> {
  const iniciado = await iniciarTransferencia(prueba, token).expect(201);
  const pagoId = iniciado.body.pago.id as string;
  const numero = datos.numero ?? numeroOperacion();
  const archivo = datos.archivo ?? png();
  await subirComprobante(prueba, token, pagoId, { archivo, numero }).expect(201);
  return { pagoId, numero, archivo, referencia: iniciado.body.transferencia.referencia };
}

/** POST de la revisión del administrador. */
export function revisar(
  prueba: AppDePrueba,
  tokenAdmin: string,
  barberiaId: string,
  pagoId: string,
  cuerpo: Record<string, unknown>,
) {
  return prueba.agente
    .post(`/api/v1/plataforma/barberias/${barberiaId}/pagos/${pagoId}/revision`)
    .set(como(tokenAdmin))
    .send(cuerpo);
}
