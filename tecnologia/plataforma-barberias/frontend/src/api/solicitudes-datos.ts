import { llamarApi } from './client';
import type { components } from './schema-007';

// T015 de 007 · Solicitudes sobre datos personales (specs/007-indicadores-datos-personales/contracts/openapi.yaml).
// Tipos generados del contrato con `npm run gen:api`.

export type Solicitud = components['schemas']['Solicitud'];
export type SolicitudEnBandeja = components['schemas']['SolicitudEnBandeja'];
export type NuevaSolicitud = components['schemas']['NuevaSolicitud'];
export type TipoSolicitud = Solicitud['tipo'];
export type EstadoSolicitud = Solicitud['estado'];
export type FiltroBandeja = 'ABIERTAS' | EstadoSolicitud;

const BASE = '/datos-personales/solicitudes';

export const clavesSolicitudes = {
  todas: ['solicitudes-datos'] as const,
  mias: ['solicitudes-datos', 'mias'] as const,
  bandeja: (filtro: FiltroBandeja) => ['solicitudes-datos', 'bandeja', filtro] as const,
};

export const TEXTO_TIPO: Record<TipoSolicitud, string> = {
  ACCESO: 'Acceso a mis datos',
  RECTIFICACION: 'Rectificación de un dato',
  ELIMINACION: 'Eliminación de mis datos',
};

export const TEXTO_ESTADO: Record<EstadoSolicitud, string> = {
  RECIBIDA: 'Recibida',
  EN_ATENCION: 'En atención',
  ATENDIDA: 'Atendida',
  RECHAZADA: 'Rechazada',
};

/** Una fecha local `YYYY-MM-DD` como "30 de noviembre de 2026" (sin hora: no depende de la zona). */
export function fechaLarga(fecha: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${fecha}T12:00:00Z`));
}

export const apiSolicitudes = {
  /** El cliente o el barbero, sobre sus propios datos. */
  registrar: (cuerpo: NuevaSolicitud) => llamarApi<Solicitud>(BASE, { metodo: 'POST', cuerpo }),
  mias: () => llamarApi<Solicitud[]>(`${BASE}/mias`),
  /** El propietario, por un cliente de su barbería. */
  registrarEnNombre: (cuerpo: NuevaSolicitud & { clienteId: string }) =>
    llamarApi<Solicitud>(`${BASE}/en-nombre`, { metodo: 'POST', cuerpo }),
  bandeja: (filtro: FiltroBandeja) =>
    llamarApi<SolicitudEnBandeja[]>(filtro === 'ABIERTAS' ? BASE : `${BASE}?estado=${filtro}`),
  iniciar: (id: string) =>
    llamarApi<SolicitudEnBandeja>(`${BASE}/${encodeURIComponent(id)}/atencion`, {
      metodo: 'POST',
      cuerpo: {},
    }),
  cerrar: (
    id: string,
    cuerpo: { resultado: 'ATENDIDA'; respuesta: string } | { resultado: 'RECHAZADA'; motivo: string },
  ) => llamarApi<SolicitudEnBandeja>(`${BASE}/${encodeURIComponent(id)}/cierre`, { metodo: 'POST', cuerpo }),
};
