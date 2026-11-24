import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { correoConParteOculta } from '../../src/api/cuenta';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { QR_DE_PRUEBA } from '../msw-handlers';
import { servidor } from '../setup';

// T055 de 010 · Aviso de verificación pendiente (contracts/pantallas.md; research R06; FR-011) en /b/<slug>/reservar,
// /asistente y /mis-citas/:id/adelanto: con `correoVerificado: false` y ante el 403 CORREO_NO_VERIFICADO. Muestra el
// correo con parte oculta y "Reenviar correo de verificación", con la confirmación y el 429. En la reserva no se pierde
// la hora elegida.

const SLUG = 'barberia-huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };
const SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const INICIO = '2026-10-20T15:00:00Z';
const CITA_ID = '0190a1b2-c3d4-7e5f-8a9b-000000000099';
const RESERVA = `/b/${SLUG}/reservar?servicio=${SERVICIO}&barbero=${BARBERO}&inicio=${encodeURIComponent(INICIO)}`;

const USUARIO = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
  nombre: 'Lucía Pariona',
  correo: 'lucia@correo.pe',
  rol: 'CLIENTE' as const,
  barberia: BARBERIA,
};

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

const ADELANTO = {
  citaId: CITA_ID,
  estado: 'POR_PAGAR',
  montoCentimos: 400,
  precioCentimos: 2000,
  saldoCentimos: 1600,
  codigo: 'K7Q2MP',
  horaLimite: '2026-10-20T10:30:00-05:00',
  limiteRevision: '2026-10-21T10:30:00-05:00',
  pago: null,
  devueltoEn: null,
};

const error = (estado: number, codigo: string, mensaje: string, encabezados: Record<string, string> = {}) =>
  HttpResponse.json({ codigo, mensaje, detalles: [] }, { status: estado, headers: encabezados });
const NO_VERIFICADO = () => error(403, 'CORREO_NO_VERIFICADO', 'Verifica tu correo para continuar.');

/** La sesión del cliente (refresh y /auth/yo) y lo que piden las tres pantallas. Devuelve los contadores. */
function servidorDelCliente(opciones: { verificado: boolean; verificadoAlComprobar?: boolean }) {
  const llamadas = { citas: 0, reenvios: 0, preguntas: 0, pagos: 0 };
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token-cliente',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: { ...USUARIO, correoVerificado: opciones.verificado },
      }),
    ),
    http.get('/api/v1/auth/yo', () =>
      HttpResponse.json({
        ...USUARIO,
        correoVerificado: opciones.verificadoAlComprobar ?? opciones.verificado,
      }),
    ),
    http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(CATALOGO)),
    http.post('/api/v1/citas', () => {
      llamadas.citas++;
      return NO_VERIFICADO();
    }),
    http.post('/api/v1/asistente/mensajes', () => {
      llamadas.preguntas++;
      return NO_VERIFICADO();
    }),
    http.get(`/api/v1/citas/${CITA_ID}/adelanto`, () => HttpResponse.json(ADELANTO)),
    http.get(
      `/api/v1/citas/${CITA_ID}/adelanto/qr`,
      () => new HttpResponse(QR_DE_PRUEBA, { headers: { 'Content-Type': 'image/png' } }),
    ),
    http.post(`/api/v1/citas/${CITA_ID}/adelanto/pago`, () => {
      llamadas.pagos++;
      return NO_VERIFICADO();
    }),
    http.post('/api/v1/cuenta/verificacion/reenvio', () => {
      llamadas.reenvios++;
      return HttpResponse.json(
        { mensaje: 'Si tu correo aún no está verificado, te enviamos un enlace nuevo.' },
        { status: 202 },
      );
    }),
  );
  return llamadas;
}

function renderizar(ruta: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const aviso = (accion: string) => screen.findByRole('region', { name: `Verifica tu correo para ${accion}` });

afterEach(() => {
  tokenEnMemoria.limpiar();
  vi.restoreAllMocks();
});

describe('Aviso de verificación pendiente', () => {
  it('el correo con parte oculta: l***@correo.pe', () => {
    expect(correoConParteOculta('lucia@correo.pe')).toBe('l***@correo.pe');
    expect(correoConParteOculta('sin-arroba')).toBe('***');
  });

  it('reserva con correoVerificado: false → aviso antes de intentar, sin perder la hora elegida', async () => {
    const llamadas = servidorDelCliente({ verificado: false });
    renderizar(RESERVA);
    const region = await aviso('reservar');
    expect(region).toHaveTextContent('l***@correo.pe');
    expect(region).not.toHaveTextContent('lucia@correo.pe');
    // La selección sigue en pantalla y no se puede confirmar todavía.
    expect(screen.getByText('Carlos Ñaupa')).toBeInTheDocument();
    expect(screen.getByText('Corte clásico')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeDisabled();
    expect(llamadas.citas).toBe(0);

    await userEvent
      .setup()
      .click(within(region).getByRole('button', { name: 'Reenviar correo de verificación' }));
    expect(await within(region).findByRole('status')).toHaveTextContent('Te enviamos un correo nuevo.');
    expect(llamadas.reenvios).toBe(1);
  });

  it('reserva con la sesión vieja (correoVerificado: true) y 403 → el mismo aviso; "Ya lo verifiqué" vuelve a habilitar', async () => {
    const llamadas = servidorDelCliente({ verificado: true, verificadoAlComprobar: false });
    renderizar(RESERVA);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Confirmar reserva' }));
    const region = await aviso('reservar');
    expect(llamadas.citas).toBe(1);
    expect(screen.getByText('Carlos Ñaupa')).toBeInTheDocument();

    await usuario.click(within(region).getByRole('button', { name: 'Ya lo verifiqué' }));
    expect(await within(region).findByText(/Aún no vemos tu correo verificado/)).toBeInTheDocument();
  });

  it('"Ya lo verifiqué" con el correo ya verificado quita el aviso y deja confirmar', async () => {
    servidorDelCliente({ verificado: false, verificadoAlComprobar: true });
    renderizar(RESERVA);
    const usuario = userEvent.setup();
    const region = await aviso('reservar');
    await usuario.click(within(region).getByRole('button', { name: 'Ya lo verifiqué' }));
    expect(await screen.findByRole('button', { name: 'Confirmar reserva' })).toBeEnabled();
    expect(
      screen.queryByRole('region', { name: 'Verifica tu correo para reservar' }),
    ).not.toBeInTheDocument();
  });

  it('reenvío con 429 → "Demasiados intentos. Vuelve a intentar en N minutos."', async () => {
    servidorDelCliente({ verificado: false });
    servidor.use(
      http.post('/api/v1/cuenta/verificacion/reenvio', () =>
        error(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos.', { 'Retry-After': '1200' }),
      ),
    );
    renderizar(RESERVA);
    const region = await aviso('reservar');
    await userEvent
      .setup()
      .click(within(region).getByRole('button', { name: 'Reenviar correo de verificación' }));
    expect(await within(region).findByRole('alert')).toHaveTextContent(
      'Demasiados intentos. Vuelve a intentar en 20 minutos.',
    );
  });

  it('/asistente con correoVerificado: false → aviso en lugar de la conversación', async () => {
    const llamadas = servidorDelCliente({ verificado: false });
    renderizar('/asistente');
    expect(await aviso('usar el asistente')).toHaveTextContent('l***@correo.pe');
    expect(screen.queryByRole('log')).not.toBeInTheDocument();
    expect(llamadas.preguntas).toBe(0);
  });

  it('/asistente con 403 al preguntar → el mismo aviso', async () => {
    servidorDelCliente({ verificado: true });
    renderizar('/asistente');
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Tu pregunta'), '¿Hay horario mañana?');
    await usuario.click(screen.getByRole('button', { name: 'Preguntar' }));
    expect(await aviso('usar el asistente')).toBeInTheDocument();
  });

  it('/mis-citas/:id/adelanto con correoVerificado: false → aviso y el registro deshabilitado', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const llamadas = servidorDelCliente({ verificado: false });
    renderizar(`/mis-citas/${CITA_ID}/adelanto`);
    expect(await aviso('pagar el adelanto')).toHaveTextContent('l***@correo.pe');
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeDisabled();
    expect(llamadas.pagos).toBe(0);
  });

  it('/mis-citas/:id/adelanto con 403 al registrar → el mismo aviso, sin perder el número escrito', async () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    servidorDelCliente({ verificado: true });
    renderizar(`/mis-citas/${CITA_ID}/adelanto`);
    const usuario = userEvent.setup();
    const numero = await screen.findByLabelText('Número de operación');
    await usuario.type(numero, 'OP12345678');
    await usuario.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await aviso('pagar el adelanto')).toBeInTheDocument();
    expect(screen.getByLabelText('Número de operación')).toHaveValue('OP12345678');
  });
});
