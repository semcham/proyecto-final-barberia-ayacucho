import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest';
import { indicadorSesion } from '../src/auth/indicadorSesion';
import { manejadoresBase } from './msw-handlers';

// La API se simula con MSW (R18). Una solicitud sin manejador hace fallar la prueba.
export const servidor = setupServer(...manejadoresBase);

// En jsdom, fetch necesita URL absolutas: las rutas relativas se resuelven contra este origen.
const fetchOriginal = globalThis.fetch;
globalThis.fetch = (entrada: RequestInfo | URL, init?: RequestInit) =>
  fetchOriginal(
    typeof entrada === 'string' && entrada.startsWith('/') ? new URL(entrada, 'http://localhost') : entrada,
    init,
  );

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

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }));
// Por defecto el navegador de prueba "tuvo sesión": la interfaz intenta renovarla con /auth/refresh, como
// tras recargar la página. Las pruebas de visitante nuevo quitan el indicador.
beforeEach(() => indicadorSesion.marcar());
afterEach(() => {
  indicadorSesion.quitar();
  servidor.resetHandlers();
  cleanup();
});
afterAll(() => servidor.close());
