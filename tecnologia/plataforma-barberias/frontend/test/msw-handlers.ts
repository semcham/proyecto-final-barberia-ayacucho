import { http, HttpResponse } from 'msw';

// Manejadores base de MSW para las pruebas del frontend. Cada prueba puede sobrescribirlos con server.use().
export const manejadoresBase = [
  http.get('/api/v1/salud', () => HttpResponse.json({ estado: 'ok' })),
  // Por defecto no hay sesión que renovar.
  http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json(
      { codigo: 'NO_AUTENTICADO', mensaje: 'Inicia sesión para continuar.', detalles: [] },
      { status: 401 },
    ),
  ),
];
