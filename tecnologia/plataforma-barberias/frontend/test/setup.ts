import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { indicadorSesion } from '../src/auth/indicadorSesion';
import { manejadoresBase } from './msw-handlers';

// La API se simula con MSW (R18). Una solicitud sin manejador hace fallar la prueba.
export const servidor = setupServer(...manejadoresBase);

function leerArchivo(archivo: Blob): Promise<ArrayBuffer> {
  if (typeof archivo.arrayBuffer === 'function') return archivo.arrayBuffer();
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(lector.result as ArrayBuffer);
    lector.onerror = () => rechazar(lector.error);
    lector.readAsArrayBuffer(archivo);
  });
}

/**
 * El FormData de jsdom no lo reconoce el fetch de Node (lo enviaría como texto). En el navegador se usa el
 * nativo; aquí se arma el mismo cuerpo multipart/form-data a mano, para que MSW lo lea como lo haría el
 * servidor (la subida del comprobante, 003).
 */
async function aMultipart(formulario: FormData): Promise<{ cuerpo: Uint8Array; tipo: string }> {
  const limite = `----limite-de-prueba-${Math.random().toString(16).slice(2)}`;
  const codificar = (texto: string) => new TextEncoder().encode(texto);
  const partes: Uint8Array[] = [];
  for (const [nombre, valor] of formulario.entries()) {
    if (typeof valor === 'string') {
      partes.push(
        codificar(`--${limite}\r\nContent-Disposition: form-data; name="${nombre}"\r\n\r\n${valor}\r\n`),
      );
      continue;
    }
    partes.push(
      codificar(
        `--${limite}\r\nContent-Disposition: form-data; name="${nombre}"; filename="${valor.name}"\r\n` +
          `Content-Type: ${valor.type || 'application/octet-stream'}\r\n\r\n`,
      ),
      new Uint8Array(await leerArchivo(valor)),
      codificar('\r\n'),
    );
  }
  partes.push(codificar(`--${limite}--\r\n`));
  const cuerpo = new Uint8Array(partes.reduce((total, parte) => total + parte.length, 0));
  let posicion = 0;
  for (const parte of partes) {
    cuerpo.set(parte, posicion);
    posicion += parte.length;
  }
  return { cuerpo, tipo: `multipart/form-data; boundary=${limite}` };
}

// En jsdom, fetch necesita URL absolutas: las rutas relativas se resuelven contra este origen.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (entrada: RequestInfo | URL, init?: RequestInit) =>
  fetchOriginal(
    typeof entrada === 'string' && entrada.startsWith('/') ? new URL(entrada, 'http://localhost') : entrada,
    init,
  );

/** Va por fuera del fetch de MSW (que lo reemplaza en `listen`): convierte el FormData antes de que MSW lo lea. */
function convertirMultipart(): void {
  const conMsw = globalThis.fetch;
  globalThis.fetch = async (entrada: RequestInfo | URL, init?: RequestInit) => {
    if (!(init?.body instanceof FormData)) return conMsw(entrada, init);
    const { cuerpo, tipo } = await aMultipart(init.body);
    const encabezados = { ...(init.headers as Record<string, string> | undefined), 'Content-Type': tipo };
    // Un Uint8Array es un cuerpo válido para fetch; los tipos del DOM de esta versión no lo declaran.
    return conMsw(entrada, { ...init, headers: encabezados, body: cuerpo as unknown as BodyInit });
  };
}

// jsdom no trae las URL locales de archivos (blob:): las pruebas que las miran las espían.
URL.createObjectURL ??= () => 'blob:jsdom';
URL.revokeObjectURL ??= () => {};

// APIs del navegador que jsdom no trae y que usan los menús y ventanas de Radix (posicionamiento y puntero).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

// Las pantallas se cargan con React.lazy: la primera vez que una prueba abre una ruta, el módulo se
// transforma en ese momento. Se da más margen que el segundo por defecto para esperar elementos.
configure({ asyncUtilTimeout: 5000 });

beforeAll(() => {
  servidor.listen({ onUnhandledRequest: 'error' });
  convertirMultipart();
});
// Por defecto el navegador de prueba "tuvo sesión": la interfaz intenta renovarla con /auth/refresh, como
// tras recargar la página. Las pruebas de visitante nuevo quitan el indicador.
beforeEach(() => indicadorSesion.marcar());
afterEach(() => {
  indicadorSesion.quitar();
  servidor.resetHandlers();
  cleanup();
});
afterAll(() => servidor.close());
