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

// Una sola renovación a la vez aunque varias llamadas reciban 401 al mismo tiempo.
let renovacionEnCurso: Promise<boolean> | null = null;

/** Pide un token de acceso nuevo con la cookie de renovación. Devuelve false si no hay sesión. */
export function renovarSesion(): Promise<boolean> {
  renovacionEnCurso ??= (async () => {
    try {
      const respuesta = await fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' });
      if (!respuesta.ok) {
        tokenEnMemoria.limpiar();
        return false;
      }
      const sesion = (await respuesta.json()) as SesionResponse;
      tokenEnMemoria.fijar(sesion.tokenAcceso);
      return true;
    } catch {
      tokenEnMemoria.limpiar();
      return false;
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
  if (respuesta.status === 401 && !opciones.sinRenovar && (await renovarSesion())) {
    respuesta = await enviar(ruta, opciones);
  }
  if (!respuesta.ok) throw await aApiError(respuesta);
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}
