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
  // El panel del propietario consulta su equipo para el indicador de barberos activos.
  http.get('/api/v1/usuarios', () => HttpResponse.json({ datos: [], total: 0, pagina: 1, tamano: 100 })),
  // 003 (T062): el panel y la reserva consultan el estado de la suscripción. Por defecto, en prueba y sin avisos.
  http.get('/api/v1/suscripcion', () =>
    HttpResponse.json({
      estado: 'TRIAL',
      plan: {
        id: '0190a1b2-0000-7000-8000-0000000000a0',
        codigo: 'TRIAL',
        nombre: 'Prueba gratuita',
        precioCentimos: 0,
        moneda: 'PEN',
        maxUsuarios: 5,
        maxBarberos: 5,
        mediosDisponibles: [],
      },
      iniciaEn: '2026-10-20T15:00:00.000Z',
      finPrueba: '2026-11-03T15:00:00.000Z',
      finCobertura: '2026-11-03T15:00:00.000Z',
      finGracia: null,
      diasRestantes: 6,
      proximoPeriodo: null,
      limites: { maxUsuarios: 5, maxBarberos: 5 },
      motivoSuspension: null,
      pagoAbierto: null,
      avisos: [],
    }),
  ),
  // 003 (US4): la pantalla de suscripción muestra el historial; por defecto, vacío.
  http.get('/api/v1/suscripcion/pagos', () => HttpResponse.json({ pagos: [], total: 0 })),
  http.get('/api/v1/suscripcion/estado-operativo', () =>
    HttpResponse.json({ aceptaReservas: true, mensaje: null }),
  ),
];
