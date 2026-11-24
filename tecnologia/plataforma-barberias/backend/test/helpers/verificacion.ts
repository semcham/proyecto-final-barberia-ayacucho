import request from 'supertest';
import type { AppDePrueba } from './app';
import { correrTareasDeAvisos, esperarCorreos } from './avisos';
import { ipUnica } from './enlaces';
import type { Mailpit } from './mailpit';

// T064 de 010 (research R13) · Para las pruebas que registran un cliente por la API y necesitan su correo verificado:
// lo verifican como lo haría la persona, con el enlace que llega al buzón de pruebas (Mailpit). Las que crean la cuenta
// por SQL no lo necesitan: `sembrarCliente` y `sesionCliente` ya la crean verificada.

const URL_PUBLICA = (process.env.URL_PUBLICA ?? (process.env.FRONTEND_BASE_URL as string)).replace(
  /\/+$/,
  '',
);

/** El token del enlace de un correo de la cuenta (va en el fragmento: `URL_PUBLICA/<pagina>#<token>`). */
export function tokenDelCorreo(texto: string, pagina: 'verificar' | 'restablecer'): string {
  const coincidencia = new RegExp(
    `${URL_PUBLICA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${pagina}#([A-Za-z0-9_-]+)`,
  ).exec(texto);
  if (!coincidencia) throw new Error(`El correo no trae el enlace de /${pagina}`);
  return coincidencia[1];
}

/**
 * Envía los avisos pendientes, toma el ÚLTIMO correo de verificación de `correo` y lo usa en POST /cuenta/verificacion.
 * `previos` es cuántos correos de verificación ya había para esa dirección (por defecto, ninguno).
 */
export async function verificarPorBuzon(
  prueba: AppDePrueba,
  mailpit: Mailpit,
  correo: string,
  previos = 0,
): Promise<{ token: string; barberia: string }> {
  await correrTareasDeAvisos(prueba);
  const correos = await esperarCorreos(mailpit, correo, previos + 1);
  const token = tokenDelCorreo(correos[correos.length - 1].texto, 'verificar');
  const respuesta = await request(prueba.app.getHttpServer())
    .post('/api/v1/cuenta/verificacion')
    // Un origen propio: los usos fallidos de otras pruebas no cuentan contra este.
    .set('X-Forwarded-For', ipUnica())
    .send({ token });
  if (respuesta.status !== 200) {
    throw new Error(`La verificación por el buzón respondió ${respuesta.status}`);
  }
  return { token, barberia: (respuesta.body as { barberia: string }).barberia };
}
