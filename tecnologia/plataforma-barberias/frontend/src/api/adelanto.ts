import { llamarApi, obtenerArchivo } from './client';
import type { components } from './schema-008';

// T018 de 008 · Adelanto de reserva con QR (specs/008-adelanto-reserva-qr/contracts/openapi.yaml). Tipos generados
// del contrato con `npm run gen:api`.

export type ConfiguracionAdelanto = components['schemas']['ConfiguracionAdelanto'];
export type CambiarConfiguracionAdelanto = components['schemas']['CambiarConfiguracionAdelanto'];
export type TipoAdelanto = NonNullable<ConfiguracionAdelanto['tipo']>;
/** El adelanto de una cita (fase 3, US2): estado, monto, código, plazos y el último registro de pago. */
export type AdelantoDeCita = components['schemas']['Adelanto'];
export type EstadoAdelanto = components['schemas']['EstadoAdelanto'];

export const clavesAdelanto = {
  configuracion: ['adelanto', 'configuracion'] as const,
  qr: ['adelanto', 'qr'] as const,
  deCita: (citaId: string) => ['adelanto', 'cita', citaId] as const,
  qrDeCita: (citaId: string) => ['adelanto', 'cita', citaId, 'qr'] as const,
};

const deCita = (citaId: string) => `/citas/${encodeURIComponent(citaId)}/adelanto`;

export const apiAdelanto = {
  /** Configuración del adelanto de la barbería (solo el propietario). */
  configuracion: () => llamarApi<ConfiguracionAdelanto>('/barberia/adelanto'),
  /** Activar, cambiar o desactivar. Los cambios valen para las reservas nuevas. */
  cambiar: (cambio: CambiarConfiguracionAdelanto) =>
    llamarApi<ConfiguracionAdelanto>('/barberia/adelanto', { metodo: 'PUT', cuerpo: cambio }),
  /** Sube o reemplaza el QR de Yape o Plin (multipart; el servidor verifica el tipo por los bytes). */
  subirQr: (archivo: File) => {
    const formulario = new FormData();
    formulario.append('archivo', archivo);
    return llamarApi<ConfiguracionAdelanto>('/barberia/adelanto/qr', { metodo: 'PUT', formulario });
  },
  /** El QR vigente, como Blob en memoria (solo con la sesión: no hay URL pública). */
  qr: () => obtenerArchivo('/barberia/adelanto/qr'),
  /** Fase 3 (US2): el adelanto de una cita (el cliente, la suya; el propietario, cualquiera de su barbería). */
  deCita: (citaId: string) => llamarApi<AdelantoDeCita>(deCita(citaId)),
  /** El QR con el que se reservó la cita, como Blob en memoria. */
  qrDeCita: (citaId: string) => obtenerArchivo(`${deCita(citaId)}/qr`),
  /** El cliente registra su pago: el número de operación y, si quiere, la captura (multipart). */
  registrarPago: (citaId: string, datos: { numeroOperacion: string; captura?: File }) => {
    const formulario = new FormData();
    if (datos.captura) formulario.append('archivo', datos.captura);
    formulario.append('numeroOperacion', datos.numeroOperacion);
    return llamarApi<AdelantoDeCita>(`${deCita(citaId)}/pago`, { metodo: 'POST', formulario });
  },
};
