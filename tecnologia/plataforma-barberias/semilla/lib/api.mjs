// Funcionalidad 009 (research R04): cliente mínimo de la API pública para la semilla, la carga y los recorridos.
// Solo usa fetch. Nunca registra cuerpos, tokens ni contraseñas: los errores dicen el método, la ruta, el estado y
// el código de error de la API.
import { randomUUID } from 'node:crypto';

export class ErrorApi extends Error {
  constructor(metodo, ruta, estado, codigo) {
    super(`${metodo} ${ruta} respondió ${estado}${codigo ? ` (${codigo})` : ''}`);
    this.estado = estado;
    this.codigo = codigo;
  }
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ base: string, fetch?: typeof fetch, reintentos429?: number, espera?: (ms: number) => Promise<void> }} opciones
 */
export function crearApi({ base, fetch: f = globalThis.fetch, reintentos429 = 6, espera = esperar }) {
  const raiz = base.replace(/\/+$/, '');

  async function llamar(metodo, ruta, { cuerpo, token, cabeceras = {}, aceptar = [] } = {}) {
    for (let intento = 0; ; intento++) {
      const respuesta = await f(`${raiz}${ruta}`, {
        method: metodo,
        headers: {
          accept: 'application/json',
          ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...cabeceras,
        },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
      if (respuesta.status === 429 && intento < reintentos429) {
        // Límite de solicitudes por IP (registro, inicio de sesión): espera lo que pida la API, como mucho 65 s.
        const segundos = Number(respuesta.headers.get('retry-after')) || 10;
        await espera(Math.min(segundos, 65) * 1000);
        continue;
      }
      const texto = await respuesta.text();
      let datos;
      try {
        datos = texto ? JSON.parse(texto) : undefined;
      } catch {
        datos = undefined;
      }
      if (respuesta.ok || aceptar.includes(respuesta.status)) return { estado: respuesta.status, datos };
      throw new ErrorApi(metodo, ruta, respuesta.status, datos?.codigo);
    }
  }

  return {
    llamar,
    get: (ruta, opciones) => llamar('GET', ruta, opciones),
    post: (ruta, cuerpo, opciones = {}) => llamar('POST', ruta, { ...opciones, cuerpo }),
    put: (ruta, cuerpo, opciones = {}) => llamar('PUT', ruta, { ...opciones, cuerpo }),
    claveIdempotencia: () => randomUUID(),
  };
}
