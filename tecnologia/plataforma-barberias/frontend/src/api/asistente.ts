import { llamarApi } from './client';
import type { components } from './schema-005';

// T045 de 005 · Asistente del cliente (specs/005-asistente-ia-reportes/contracts/openapi.yaml, POST /asistente/mensajes).
// Tipos generados del contrato con `npm run gen:api`. La conversación vive solo en memoria: el servidor no guarda
// historial y la página envía como mucho las últimas 6 intervenciones (FR-012).

export type RespuestaAsistente = components['schemas']['RespuestaAsistente'];
export type Intervencion = components['schemas']['Intervencion'];

export const MAXIMO_CARACTERES = 500;
export const MAXIMO_INTERVENCIONES = 6;

export const apiAsistente = {
  preguntar: (mensaje: string, contexto: Intervencion[]) =>
    llamarApi<RespuestaAsistente>('/asistente/mensajes', {
      metodo: 'POST',
      cuerpo: { mensaje, contexto: contexto.slice(-MAXIMO_INTERVENCIONES) },
    }),
};
