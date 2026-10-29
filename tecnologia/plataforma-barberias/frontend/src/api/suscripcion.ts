import { llamarApi, obtenerArchivo } from './client';
import type { components } from './schema-003';

// T050 · Suscripción y pago con Yape (funcionalidad 003, specs/003-suscripciones-pagos/contracts/openapi.yaml).
// Tipos generados del contrato con `npm run gen:api`.

export type Plan = components['schemas']['Plan'];
export type Suscripcion = components['schemas']['Suscripcion'];
export type EstadoOperativo = components['schemas']['EstadoOperativo'];
export type Pago = components['schemas']['Pago'];
export type PagoIniciado = components['schemas']['PagoIniciado'];
export type EstadoSuscripcion = Suscripcion['estado'];
export type EstadoPago = Pago['estado'];

export const apiSuscripcion = {
  /** Planes contratables (solo el propietario). */
  planes: () => llamarApi<Plan[]>('/planes'),
  /** Estado, plan vigente, fechas, límites y avisos (solo el propietario). */
  suscripcion: () => llamarApi<Suscripcion>('/suscripcion'),
  /** Si la barbería acepta reservas (propietario, barbero y cliente; FR-039). */
  estadoOperativo: () => llamarApi<EstadoOperativo>('/suscripcion/estado-operativo'),
  /** Inicia el pago de un período. Devuelve la URL de la página del proveedor (Yape). */
  iniciarPago: (planId: string, medio: 'YAPE' | 'TRANSFERENCIA' = 'YAPE') =>
    llamarApi<PagoIniciado>('/suscripcion/pagos', { metodo: 'POST', cuerpo: { planId, medio } }),
  /** Estado de un pago: la pantalla lo consulta al volver del proveedor. */
  pago: (id: string) => llamarApi<Pago>(`/suscripcion/pagos/${encodeURIComponent(id)}`),
  /** US3 (T084): sube el comprobante de la transferencia (multipart; el servidor verifica el tipo por bytes). */
  subirComprobante: (
    pagoId: string,
    datos: { archivo: File; numeroOperacion: string; fechaTransferencia: string },
  ) => {
    const formulario = new FormData();
    formulario.append('archivo', datos.archivo);
    formulario.append('numeroOperacion', datos.numeroOperacion);
    formulario.append('fechaTransferencia', datos.fechaTransferencia);
    return llamarApi<Pago>(`/suscripcion/pagos/${encodeURIComponent(pagoId)}/comprobante`, {
      metodo: 'POST',
      formulario,
    });
  },
  /** El comprobante subido, como Blob en memoria (solo con la sesión). */
  comprobante: (pagoId: string) =>
    obtenerArchivo(`/suscripcion/pagos/${encodeURIComponent(pagoId)}/comprobante`),
};
