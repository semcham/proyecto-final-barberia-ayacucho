import { ApiError, llamarApi } from './client';
import type { paths } from './schema-010';

// 010 · Enlaces de cuenta por correo (specs/010-acceso-verificado/contracts/openapi.yaml).

type Verificado = paths['/cuenta/verificacion']['post']['responses']['200']['content']['application/json'];
type Neutra = { mensaje: string };

/** POST /cuenta/verificacion (sin sesión): el token va solo en el cuerpo, nunca en la dirección (R09). */
export const verificarCorreo = (token: string) =>
  llamarApi<Verificado>('/cuenta/verificacion', { metodo: 'POST', cuerpo: { token }, sinRenovar: true });

/** POST /cuenta/verificacion/reenvio (con sesión): siempre la misma respuesta neutra, o 429. */
export const reenviarVerificacion = () =>
  llamarApi<Neutra>('/cuenta/verificacion/reenvio', { metodo: 'POST' });

/** El 403 CORREO_NO_VERIFICADO de reservar, preguntar al asistente o pagar el adelanto. */
export const esCorreoNoVerificado = (error: unknown): boolean =>
  error instanceof ApiError && error.codigo === 'CORREO_NO_VERIFICADO';

/** "Demasiados intentos. Vuelve a intentar en N minutos." (contracts/pantallas.md), o el mensaje del error. */
export function mensajeDeErrorDeCuenta(error: unknown): string {
  if (error instanceof ApiError && error.estado === 429) {
    const minutos = Math.max(1, Math.ceil((error.reintentarEnSegundos ?? 60) / 60));
    return `Demasiados intentos. Vuelve a intentar en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
  }
  return error instanceof ApiError ? error.message : 'No pudimos conectar con el servidor. Intenta de nuevo.';
}

/** `lucia@correo.pe` → `l***@correo.pe`: se reconoce el correo sin mostrarlo entero (contracts/pantallas.md). */
export function correoConParteOculta(correo: string): string {
  const arroba = correo.lastIndexOf('@');
  if (arroba < 1) return '***';
  return `${correo[0]}***${correo.slice(arroba)}`;
}

/** POST /cuenta/recuperacion (sin sesión): siempre la misma respuesta neutra, o 429. `barberia`: el slug del ingreso. */
export const pedirRecuperacion = (correo: string, barberia?: string) =>
  llamarApi<Neutra>('/cuenta/recuperacion', {
    metodo: 'POST',
    cuerpo: { correo, ...(barberia && { barberia }) },
    sinRenovar: true,
  });

/** POST /cuenta/recuperacion/contrasena (sin sesión): 204, 410 (enlace no válido), 422 (reglas) o 429. */
export const restablecerContrasena = (token: string, contrasena: string) =>
  llamarApi<void>('/cuenta/recuperacion/contrasena', {
    metodo: 'POST',
    cuerpo: { token, contrasena },
    sinRenovar: true,
  });
