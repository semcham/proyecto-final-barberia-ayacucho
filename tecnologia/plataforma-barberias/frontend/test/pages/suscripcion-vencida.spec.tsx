import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { ReservarProtegida } from '../../src/pages/publico/Reservar';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T057 · Interfaz con la suscripción en gracia, vencida o suspendida (US2; FR-006, FR-007, FR-039): la reserva
// avisa "no acepta reservas por ahora" antes de confirmar, el panel muestra el aviso de gracia con su fecha, y
// un formulario del catálogo que recibe 403 SUSCRIPCION_NO_PERMITE muestra el mensaje del servidor.

const SLUG = 'barberia-huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };
const SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const INICIO = '2026-10-20T15:00:00Z';
const NO_ACEPTA = 'Esta barbería no acepta reservas por ahora';
const NO_PERMITE = 'Tu suscripción no permite este cambio';

const sesion = (rol: 'CLIENTE' | 'PROPIETARIO' | 'BARBERO') =>
  http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
        nombre: 'Rosa Quispe',
        correo: 'rosa@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );

const CATALOGO = {
  barberia: {
    nombre: 'Barbería Huamanga',
    slug: SLUG,
    direccion: null,
    telefono: null,
    descripcion: null,
    zonaHoraria: 'America/Lima',
  },
  horario: { tramos: [{ diaSemana: 2, inicio: '09:00', fin: '19:00' }] },
  servicios: [
    { id: SERVICIO, nombre: 'Corte clásico', descripcion: null, precio: '25.00', duracionMinutos: 30 },
  ],
  barberos: [{ id: BARBERO, nombre: 'Carlos Ñaupa', servicioIds: [SERVICIO] }],
};

const SUSCRIPCION = (cambios: object) => ({
  estado: 'TRIAL',
  plan: {
    id: '0190a1b2-0000-7000-8000-0000000000a1',
    codigo: 'BASICO',
    nombre: 'Básico',
    precioCentimos: 4900,
    moneda: 'PEN',
    maxUsuarios: 3,
    maxBarberos: 3,
    mediosDisponibles: ['YAPE'],
  },
  iniciaEn: '2026-09-20T15:00:00.000Z',
  finPrueba: '2026-09-20T15:00:00.000Z',
  finCobertura: '2026-10-25T15:00:00.000Z',
  finGracia: null,
  diasRestantes: 0,
  proximoPeriodo: null,
  limites: { maxUsuarios: 3, maxBarberos: 3 },
  motivoSuspension: null,
  pagoAbierto: null,
  avisos: [],
  ...cambios,
});

const restriccion = (estado: string, accion: string, mensaje: string) =>
  HttpResponse.json(
    { codigo: 'SUSCRIPCION_NO_PERMITE', mensaje, detalles: [{ estado, accion }] },
    { status: 403 },
  );

function renderizar(ruta: string, contenido = <RutasApp />) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>{contenido}</SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// El panel lee la configuración de la barbería (zona horaria) en todas sus pantallas.
beforeEach(() =>
  servidor.use(
    http.get('/api/v1/barberia', () =>
      HttpResponse.json({ ...CATALOGO.barberia, antelacionCancelacionMinutos: 120 }),
    ),
  ),
);
afterEach(() => tokenEnMemoria.limpiar());

describe('Reserva con la barbería vencida', () => {
  const reservar = () =>
    renderizar(
      `/b/${SLUG}/reservar?servicio=${SERVICIO}&barbero=${BARBERO}&inicio=${encodeURIComponent(INICIO)}`,
      <Routes>
        <Route path="/b/:slug" element={<h1>Catálogo de la barbería</h1>} />
        <Route path="/b/:slug/reservar" element={<ReservarProtegida />} />
      </Routes>,
    );

  it('si no acepta reservas, lo avisa antes de confirmar y no ofrece el botón ni llama a POST /citas', async () => {
    let reservas = 0;
    servidor.use(
      sesion('CLIENTE'),
      http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(CATALOGO)),
      http.get('/api/v1/suscripcion/estado-operativo', () =>
        HttpResponse.json({ aceptaReservas: false, mensaje: NO_ACEPTA }),
      ),
      http.post('/api/v1/citas', () => {
        reservas += 1;
        return HttpResponse.json({}, { status: 201 });
      }),
    );
    reservar();
    expect(await screen.findByText(NO_ACEPTA)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar reserva/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/horario no disponible/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /volver a la barbería/i })).toHaveAttribute('href', `/b/${SLUG}`);
    expect(reservas).toBe(0);
  });

  it('si vence con la confirmación abierta, el 403 muestra el aviso y no vuelve a los horarios', async () => {
    let aceptaReservas = true;
    servidor.use(
      sesion('CLIENTE'),
      http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(CATALOGO)),
      http.get('/api/v1/suscripcion/estado-operativo', () =>
        HttpResponse.json({ aceptaReservas, mensaje: aceptaReservas ? null : NO_ACEPTA }),
      ),
      http.post('/api/v1/citas', () => {
        aceptaReservas = false;
        return restriccion('EXPIRED', 'RESERVAR', NO_ACEPTA);
      }),
    );
    reservar();
    await userEvent.setup().click(await screen.findByRole('button', { name: /confirmar reserva/i }));
    expect(await screen.findByText(NO_ACEPTA)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /confirmar reserva/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /catálogo de la barbería/i })).not.toBeInTheDocument();
  });
});

describe('Aviso del panel', () => {
  const panel = (suscripcion: object) =>
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/suscripcion', () => HttpResponse.json(SUSCRIPCION(suscripcion))),
      http.get('/api/v1/servicios', () => HttpResponse.json([])),
      http.get('/api/v1/barberos', () => HttpResponse.json([])),
    );
  const aviso = async (): Promise<HTMLElement> => {
    await waitFor(() => expect(document.querySelector('[data-aviso-suscripcion]')).not.toBeNull());
    return document.querySelector('[data-aviso-suscripcion]') as HTMLElement;
  };

  it('en gracia, muestra hasta cuándo se puede pagar y el acceso a la suscripción', async () => {
    panel({ estado: 'PAST_DUE', finGracia: '2026-11-01T15:00:00.000Z', avisos: ['EN_GRACIA'] });
    renderizar('/app/servicios');
    const elemento = await aviso();
    expect(elemento).toHaveTextContent('Tu pago está pendiente');
    expect(elemento).toHaveTextContent('1 de noviembre de 2026');
    expect(within(elemento).getByRole('link', { name: /pagar ahora/i })).toHaveAttribute(
      'href',
      '/app/suscripcion',
    );
  });

  it('vencida: avisa que no recibe reservas y que los datos se conservan', async () => {
    panel({ estado: 'EXPIRED', avisos: ['VENCIDA'] });
    renderizar('/app/servicios');
    expect(await aviso()).toHaveTextContent(/no recibe reservas nuevas.*se conservan/);
  });

  it('suspendida: muestra el motivo', async () => {
    panel({
      estado: 'SUSPENDED',
      motivoSuspension: 'Pago observado por el banco',
      avisos: ['SUSPENDIDA'],
    });
    renderizar('/app/servicios');
    expect(await aviso()).toHaveTextContent('suspendida: Pago observado por el banco');
  });

  it('el barbero solo ve que la barbería no acepta reservas, sin el estado de la suscripción', async () => {
    servidor.use(
      sesion('BARBERO'),
      http.get('/api/v1/suscripcion/estado-operativo', () =>
        HttpResponse.json({ aceptaReservas: false, mensaje: NO_ACEPTA }),
      ),
      http.get('/api/v1/agenda', () => HttpResponse.json({ fecha: '2026-10-28', citas: [] })),
      http.get('/api/v1/barberos', () => HttpResponse.json([])),
      http.get('/api/v1/barberia', () =>
        HttpResponse.json({ ...CATALOGO.barberia, antelacionCancelacionMinutos: 120 }),
      ),
    );
    renderizar('/app');
    const elemento = await aviso();
    expect(elemento).toHaveTextContent(NO_ACEPTA);
    expect(elemento).not.toHaveTextContent(/vencid|gracia|suspendid/i);
    expect(within(elemento).queryByRole('link', { name: /pagar/i })).not.toBeInTheDocument();
  });

  it('sin avisos no muestra nada', async () => {
    panel({});
    renderizar('/app/servicios');
    expect(await screen.findByRole('form', { name: /nuevo servicio/i })).toBeInTheDocument();
    expect(document.querySelector('[data-aviso-suscripcion]')).toBeNull();
  });
});

describe('Catálogo con la suscripción vencida', () => {
  it('un formulario que recibe 403 SUSCRIPCION_NO_PERMITE muestra "Tu suscripción no permite este cambio"', async () => {
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/suscripcion', () => HttpResponse.json(SUSCRIPCION({}))),
      http.get('/api/v1/servicios', () => HttpResponse.json([])),
      http.post('/api/v1/servicios', () => restriccion('EXPIRED', 'CONFIGURAR_CATALOGO', NO_PERMITE)),
    );
    renderizar('/app/servicios');
    const usuario = userEvent.setup();
    const formulario = await screen.findByRole('form', { name: /nuevo servicio/i });
    await usuario.type(within(formulario).getByLabelText(/^nombre$/i), 'Barba');
    await usuario.type(within(formulario).getByLabelText(/precio/i), '15');
    await usuario.click(within(formulario).getByRole('button', { name: /agregar servicio/i }));
    expect(await screen.findByText(NO_PERMITE)).toBeInTheDocument();
    expect(screen.queryByText(/horario no disponible/i)).not.toBeInTheDocument();
  });

  it('sin mensaje en la respuesta, el cliente de la API usa el del contrato', async () => {
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/suscripcion', () => HttpResponse.json(SUSCRIPCION({}))),
      http.get('/api/v1/servicios', () => HttpResponse.json([])),
      http.post('/api/v1/servicios', () => restriccion('SUSPENDED', 'CONFIGURAR_CATALOGO', '')),
    );
    renderizar('/app/servicios');
    const usuario = userEvent.setup();
    const formulario = await screen.findByRole('form', { name: /nuevo servicio/i });
    await usuario.type(within(formulario).getByLabelText(/^nombre$/i), 'Barba');
    await usuario.type(within(formulario).getByLabelText(/precio/i), '15');
    await usuario.click(within(formulario).getByRole('button', { name: /agregar servicio/i }));
    expect(await screen.findByText(NO_PERMITE)).toBeInTheDocument();
  });
});
