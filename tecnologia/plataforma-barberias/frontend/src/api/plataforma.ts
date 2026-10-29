import { aApiError, conBloqueoEntrePestanas, type OpcionesLlamada } from './client';

// T071 · Cliente de la API del administrador de la plataforma (003, R07, ADR-031). Separado del de las
// barberías a propósito:
// - su token de acceso vive en su propia variable en memoria (nunca en localStorage ni sessionStorage), y el
//   cliente de las barberías no lo envía nunca;
// - se renueva con su propia cookie (`/api/v1/plataforma/auth`) y su propio bloqueo entre pestañas: el
//   servidor no tiene período de gracia para esta sesión, así que dos pestañas no deben renovar a la vez.

const BASE = '/api/v1';

export interface Desafio {
  desafio: string;
  expiraEn: string;
}

interface TokenPlataforma {
  tokenAcceso: string;
  tipo: 'Bearer';
  expiraEn: string;
}

export type CodigoSegundoFactor = { codigo: string } | { codigoRecuperacion: string };

let tokenAcceso: string | null = null;

/** Token de la sesión de plataforma, solo en memoria. */
export const tokenPlataforma = {
  obtener: (): string | null => tokenAcceso,
  limpiar: (): void => {
    tokenAcceso = null;
  },
};

function enviar(ruta: string, { metodo = 'GET', cuerpo }: Pick<OpcionesLlamada, 'metodo' | 'cuerpo'>) {
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

let renovacionEnCurso: Promise<boolean> | null = null;

/** Renueva la sesión de plataforma con su cookie. Devuelve false si no hay sesión válida. */
export function renovarPlataforma(): Promise<boolean> {
  renovacionEnCurso ??= (async () => {
    try {
      const respuesta = await conBloqueoEntrePestanas(
        () => fetch(`${BASE}/plataforma/auth/renovar`, { method: 'POST', credentials: 'include' }),
        'renovar-sesion-plataforma',
      );
      if (!respuesta.ok) {
        tokenAcceso = null;
        return false;
      }
      tokenAcceso = ((await respuesta.json()) as TokenPlataforma).tokenAcceso;
      return true;
    } catch {
      tokenAcceso = null;
      return false;
    } finally {
      renovacionEnCurso = null;
    }
  })();
  return renovacionEnCurso;
}

async function solicitar(
  ruta: string,
  opciones: Pick<OpcionesLlamada, 'metodo' | 'cuerpo' | 'sinRenovar'>,
): Promise<Response> {
  let respuesta = await enviar(ruta, opciones);
  if (respuesta.status === 401 && !opciones.sinRenovar && (await renovarPlataforma())) {
    respuesta = await enviar(ruta, opciones);
  }
  if (!respuesta.ok) throw await aApiError(respuesta);
  return respuesta;
}

/** Llama a una ruta /plataforma/*. Ante un 401 renueva UNA vez y repite; si no, lanza ApiError. */
export async function llamarPlataforma<T>(
  ruta: string,
  opciones: Pick<OpcionesLlamada, 'metodo' | 'cuerpo' | 'sinRenovar'> = {},
): Promise<T> {
  const respuesta = await solicitar(ruta, opciones);
  if (respuesta.status === 204) return undefined as T;
  return (await respuesta.json()) as T;
}

/** Comprobante en la cola del administrador (contracts/openapi.yaml, ComprobantePorRevisar). */
export interface ComprobantePorRevisar {
  barberia: { id: string; nombre: string };
  pago: {
    id: string;
    plan: string;
    importeCentimos: number;
    referencia: string;
    numeroOperacionFinal: string;
    numeroRepetido: boolean;
    fechaTransferencia: string;
    /** Cuándo se inició el pago (FR-020b). */
    pagoIniciadoEn: string;
    /** La fecha de la transferencia es anterior al inicio del pago (marca FECHA_ANTERIOR_AL_PAGO). */
    fechaAnteriorAlPago: boolean;
    numeroYaUsadoEn: string[];
  };
  enviadoEn: string;
}

export interface DetalleDePago {
  pago: { id: string; estado: string; importeCentimos: number };
  numeroOperacion: string | null;
  fechaTransferencia: string | null;
}

export type Revision =
  { resultado: 'APROBADO'; importeTransferidoCentimos: number } | { resultado: 'RECHAZADO'; motivo: string };

const rutaDePago = (barberiaId: string, pagoId: string) =>
  `/plataforma/barberias/${encodeURIComponent(barberiaId)}/pagos/${encodeURIComponent(pagoId)}`;

/** US3 (T084): comprobantes por revisar. */
export const apiComprobantesPlataforma = {
  cola: () => llamarPlataforma<ComprobantePorRevisar[]>('/plataforma/comprobantes'),
  /** El número de operación completo solo llega aquí (H2). */
  detalle: (barberiaId: string, pagoId: string) =>
    llamarPlataforma<DetalleDePago>(rutaDePago(barberiaId, pagoId)),
  /** El archivo en memoria, con la sesión de plataforma; la pantalla lo abre como `blob:` y lo revoca. */
  archivo: async (barberiaId: string, pagoId: string): Promise<Blob> =>
    (await solicitar(`${rutaDePago(barberiaId, pagoId)}/comprobante`, {})).blob(),
  revisar: (barberiaId: string, pagoId: string, revision: Revision) =>
    llamarPlataforma<unknown>(`${rutaDePago(barberiaId, pagoId)}/revision`, {
      metodo: 'POST',
      cuerpo: revision,
    }),
};

export const apiPlataforma = {
  /** Primer paso: correo y contraseña → desafío de 5 minutos. */
  ingresar: (correo: string, contrasena: string) =>
    llamarPlataforma<Desafio>('/plataforma/auth/ingresar', {
      metodo: 'POST',
      cuerpo: { correo, contrasena },
      sinRenovar: true,
    }),
  /** Segundo paso: el desafío y el código TOTP o uno de recuperación → token de plataforma (en memoria). */
  async verificar(desafio: string, codigo: CodigoSegundoFactor): Promise<void> {
    const sesion = await llamarPlataforma<TokenPlataforma>('/plataforma/auth/segundo-factor', {
      metodo: 'POST',
      cuerpo: { desafio, ...codigo },
      sinRenovar: true,
    });
    tokenAcceso = sesion.tokenAcceso;
  },
  /**
   * Cierra la sesión en el servidor (si el token de acceso venció, renueva antes para que la sesión quede
   * cerrada de verdad). El token local se borra aunque la llamada falle.
   */
  async salir(): Promise<void> {
    try {
      await llamarPlataforma<void>('/plataforma/auth/salir', { metodo: 'POST' });
    } finally {
      tokenAcceso = null;
    }
  },
};
