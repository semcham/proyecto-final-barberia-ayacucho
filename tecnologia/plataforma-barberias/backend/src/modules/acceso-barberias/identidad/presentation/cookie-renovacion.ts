import type { Response } from 'express';

export const NOMBRE_COOKIE_RENOVACION = 'rt';
const RUTA = '/api/v1/auth';
const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cookie del token de renovación (R08): HttpOnly (JavaScript no la lee), Secure, SameSite=Strict y
 * limitada a /api/v1/auth para que solo viaje en las rutas de sesión.
 */
export function fijarCookieRenovacion(respuesta: Response, token: string): void {
  respuesta.cookie(NOMBRE_COOKIE_RENOVACION, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: RUTA,
    maxAge: SIETE_DIAS_MS,
  });
}

export function borrarCookieRenovacion(respuesta: Response): void {
  respuesta.clearCookie(NOMBRE_COOKIE_RENOVACION, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: RUTA,
  });
}
