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

/**
 * 004 (T086): respuestas de las rutas de enlaces (GET /enlaces/accion y POST /enlaces/accion/*): 200, 410 y 429.
 * Cada una guarda el encabezado X-Enlace-Accion (y el cuerpo) que recibe, para que la prueba compruebe que el
 * token viaja en el encabezado y nunca en la URL.
 */
export const enlaces = {
  consulta: (datos: Record<string, unknown>, recibidos: string[] = []) =>
    http.get('/api/v1/enlaces/accion', ({ request }) => {
      recibidos.push(`${request.headers.get('x-enlace-accion')}|${request.url}`);
      return HttpResponse.json(datos);
    }),
  accion: (
    accion: 'confirmar' | 'cancelar' | 'reprogramar',
    resultado: Record<string, unknown>,
    recibidos: unknown[] = [],
  ) =>
    http.post(`/api/v1/enlaces/accion/${accion}`, async ({ request }) => {
      recibidos.push({ token: request.headers.get('x-enlace-accion'), cuerpo: await request.json() });
      return HttpResponse.json(resultado);
    }),
  noValido: (metodo: 'get' | 'post' = 'get', ruta = '/api/v1/enlaces/accion') =>
    http[metodo](ruta, () =>
      HttpResponse.json(
        {
          codigo: 'ENLACE_NO_VALIDO',
          mensaje: 'Este enlace ya no es válido. Inicia sesión para gestionar tus citas.',
          detalles: [],
        },
        { status: 410 },
      ),
    ),
  demasiados: (segundos: number) =>
    http.get('/api/v1/enlaces/accion', () =>
      HttpResponse.json(
        {
          codigo: 'DEMASIADOS_INTENTOS',
          mensaje: 'Demasiados intentos. Espera un momento antes de volver a intentar.',
          detalles: [{ reintentarEnSegundos: segundos }],
        },
        { status: 429, headers: { 'Retry-After': String(segundos) } },
      ),
    ),
};

/** Cita mínima que devuelve POST /citas/{id}/reprogramar (CitaConConfirmacion de 004). */
interface CitaReprogramable {
  id: string;
  servicio: string;
  barbero: string;
  inicio: string;
  fin: string;
  estado: string;
  [campo: string]: unknown;
}

/**
 * 004 (T045): respuestas de POST /citas/{id}/reprogramar (200, 409 y 422). Cada una guarda los cuerpos que
 * recibe en `solicitudes`, para que la prueba compruebe qué se envió.
 */
export const reprogramacion = {
  /** 200: la cita queda a la hora pedida (30 min), confirmada y sin la confirmación del cliente. */
  exito: (cita: CitaReprogramable, solicitudes: unknown[] = []) =>
    http.post(`/api/v1/citas/${cita.id}/reprogramar`, async ({ request }) => {
      const cuerpo = (await request.json()) as { inicio: string; barberoId?: string };
      solicitudes.push(cuerpo);
      const fin = new Date(Date.parse(cuerpo.inicio) + 30 * 60_000);
      return HttpResponse.json({
        cita: {
          ...cita,
          inicio: cuerpo.inicio,
          fin: `${new Date(fin.getTime() - 5 * 3_600_000).toISOString().slice(0, 19)}-05:00`,
          estado: 'CONFIRMADA',
          confirmadaPorClienteEn: null,
        },
        cambio: true,
        inicioAnterior: cita.inicio,
      });
    }),
  /** 409: la hora se ocupó mientras tanto; la cita conserva su hora. */
  ocupada: (citaId: string, solicitudes: unknown[] = []) =>
    http.post(`/api/v1/citas/${citaId}/reprogramar`, async ({ request }) => {
      solicitudes.push(await request.json());
      return HttpResponse.json(
        {
          codigo: 'HORARIO_NO_DISPONIBLE',
          mensaje: 'Ese horario ya no está disponible. Elige otra hora.',
          detalles: [],
        },
        { status: 409 },
      );
    }),
  /** 422: el cliente ya no tiene la antelación mínima; la interfaz ofrece cancelar. */
  sinAntelacion: (citaId: string, solicitudes: unknown[] = []) =>
    http.post(`/api/v1/citas/${citaId}/reprogramar`, async ({ request }) => {
      solicitudes.push(await request.json());
      return HttpResponse.json(
        {
          codigo: 'SIN_ANTELACION_PARA_REPROGRAMAR',
          mensaje:
            'Ya no se puede reprogramar esta cita: falta menos que la antelación mínima de la barbería. Puedes cancelarla.',
          detalles: [{ puedeCancelar: true }],
        },
        { status: 422 },
      );
    }),
};
