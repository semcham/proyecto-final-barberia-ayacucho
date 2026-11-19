// Funcionalidad 009 (research R04 y R05): lee del buzón de desarrollo (API HTTP de Mailpit) el enlace con token que
// llegó a un correo. Lo usan los recorridos de extremo a extremo y la preparación de la carga; la semilla no lo
// necesita (el registro de la barbería devuelve la sesión y el alta de un barbero devuelve su enlace de activación).
// Nunca registra el contenido del correo ni el token.

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Busca el último correo dirigido a `correo` y devuelve el primer enlace que contenga `token=`.
 * @param {{ buzon: string, correo: string, fetch?: typeof fetch, esperaMaximaMs?: number, intervaloMs?: number }} o
 * @returns {Promise<string>}
 */
export async function leerEnlace({
  buzon,
  correo,
  fetch: f = globalThis.fetch,
  esperaMaximaMs = 15000,
  intervaloMs = 500,
}) {
  const raiz = buzon.replace(/\/+$/, '');
  const limite = Date.now() + esperaMaximaMs;
  for (;;) {
    const busqueda = await f(`${raiz}/api/v1/search?query=${encodeURIComponent(`to:${correo}`)}&limit=1`);
    if (busqueda.ok) {
      const { messages = [] } = await busqueda.json();
      if (messages.length > 0) {
        const mensaje = await f(`${raiz}/api/v1/message/${encodeURIComponent(messages[0].ID)}`);
        if (mensaje.ok) {
          const { Text = '', HTML = '' } = await mensaje.json();
          const enlace = /https?:\/\/[^\s"'<>]*token=[^\s"'<>]+/.exec(`${Text}\n${HTML}`);
          if (enlace) return enlace[0].replace(/&amp;/g, '&');
        }
      }
    }
    if (Date.now() >= limite) {
      throw new Error(
        `No llegó al buzón de desarrollo un correo con enlace para ${correo} en ${esperaMaximaMs / 1000} s.`,
      );
    }
    await esperar(intervaloMs);
  }
}
