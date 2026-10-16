import type { components } from './schema';

type CuerpoError = components['schemas']['Error'];
type SesionResponse = components['schemas']['SesionResponse'];

const BASE = '/api/v1';

/** Error de la API con el formato único { codigo, mensaje, detalles } del contrato. */
export class ApiError extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: CuerpoError['codigo'],
    mensaje: string,
    readonly detalles: Record<string, unknown>[] = [],
    /** Segundos de espera indicados por Retry-After (429). */
    readonly reintentarEnSegundos?: number,
  ) {
    super(mensaje);
    this.name = 'ApiError';
  }
}

// El token de acceso vive solo en memoria (nunca en localStorage, R19). La renovación usa la cookie HttpOnly.
let tokenAcceso: string | null = null;

export const tokenEnMemoria = {
  obtener: (): string | null => tokenAcceso,
  fijar: (token: string): void => {
    tokenAcceso = token;
  },
  limpiar: (): void => {
    tokenAcceso = null;
  },
};

export interface OpcionesLlamada {
  metodo?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  cuerpo?: unknown;
  /** No intentar renovar la sesión ante un 401 (p. ej. en el propio inicio de sesión). */
  sinRenovar?: boolean;
}

function enviar(ruta: string, { metodo = 'GET', cuerpo }: OpcionesLlamada): Promise<Response> {
  const encabezados: Record<string, string> = { Accept: 'application/json' };
  if (cuerpo !== undefined) encabezados['Content-Type'] = 'application/json';
  if (tokenAcceso) encabezados.Authorization = `Bearer ${tokenAcceso}`;
  return fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: encabezados,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    credentials: 'include',
  });
}

async function aApiError(respuesta: Response): Promise<ApiError> {
  const espera = Number(respuesta.headers.get('Retry-After'));
  try {
    const cuerpo = (await respuesta.json()) as CuerpoError;
    return new ApiError(
      respuesta.status,
      cuerpo.codigo,
      cuerpo.mensaje,
      cuerpo.detalles ?? [],
      Number.isFinite(espera) && espera > 0 ? espera : undefined,
    );
  } catch {
    return new ApiError(respuesta.status, 'ERROR_INTERNO', 'Ocurrió un error inesperado. Intenta de nuevo.');
  }
}

// Avisos de "la sesión se perdió" (la renovación falló): la interfaz vuelve a la pantalla de ingreso.
const alPerderSesion = new Set<() => void>();

/** Se suscribe al aviso de sesión perdida. Devuelve la función para cancelar la suscripción. */
export function suscribirSesionPerdida(oyente: () => void): () => void {
  alPerderSesion.add(oyente);
  return () => alPerderSesion.delete(oyente);
}

// Una sola renovación a la vez aunque varias llamadas reciban 401 al mismo tiempo.
let renovacionEnCurso: Promise<SesionResponse | null> | null = null;

/**
 * Ejecuta la renovación con el bloqueo "renovar-sesion" de la Web Locks API, compartido por todas las
 * pestañas del sitio: la segunda pestaña renueva después de la primera, ya con la cookie nueva, y no
 * presenta el token que la primera acaba de rotar (FR-008a). Sin la API, se renueva directamente.
 */
function conBloqueoEntrePestanas<T>(tarea: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? (locks.request('renovar-sesion', tarea) as Promise<T>) : tarea();
}

/**
 * Pide un token de acceso nuevo con la cookie de renovación (que el servidor rota). Devuelve la sesión
 * renovada, o null si no hay sesión válida.
 */
export function renovarSesion(): Promise<SesionResponse | null> {
  renovacionEnCurso ??= (async () => {
    try {
      const respuesta = await conBloqueoEntrePestanas(() =>
        fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' }),
      );
      if (!respuesta.ok) {
        tokenEnMemoria.limpiar();
        return null;
      }
      const sesion = (await respuesta.json()) as SesionResponse;
      tokenEnMemoria.fijar(sesion.tokenAcceso);
      return sesion;
    } catch {
      tokenEnMemoria.limpiar();
      return null;
    } finally {
      renovacionEnCurso = null;
    }
  })();
  return renovacionEnCurso;
}

/**
 * Llama a la API REST. Ante un 401 intenta UNA sola vez renovar la sesión y repetir la llamada; si la
 * respuesta no es correcta, lanza un ApiError tipado.
 */
export async function llamarApi<T>(ruta: string, opciones: OpcionesLlamada = {}): Promise<T> {
  let respuesta = await enviar(ruta, opciones);
  if (respuesta.status === 401 && !opciones.sinRenovar) {
    if (await renovarSesion()) {
      respuesta = await enviar(ruta, opciones);
    } else {
      alPerderSesion.forEach((oyente) => oyente());
    }
  }
  if (!respuesta.ok) throw await aApiError(respuesta);
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}
