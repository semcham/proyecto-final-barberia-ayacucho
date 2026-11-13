import { llamarApi, obtenerArchivo } from './client';
import type { components } from './schema-008';

// T018 de 008 · Adelanto de reserva con QR (specs/008-adelanto-reserva-qr/contracts/openapi.yaml). Tipos generados
// del contrato con `npm run gen:api`.

export type ConfiguracionAdelanto = components['schemas']['ConfiguracionAdelanto'];
export type CambiarConfiguracionAdelanto = components['schemas']['CambiarConfiguracionAdelanto'];
export type TipoAdelanto = NonNullable<ConfiguracionAdelanto['tipo']>;

export const clavesAdelanto = {
  configuracion: ['adelanto', 'configuracion'] as const,
  qr: ['adelanto', 'qr'] as const,
};

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
};
