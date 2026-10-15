import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll } from 'vitest';
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

beforeAll(() => servidor.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  servidor.resetHandlers();
  cleanup();
});
afterAll(() => servidor.close());
