import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import type { components } from '../../src/api/schema-002';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { ReservarProtegida } from '../../src/pages/publico/Reservar';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T115 · Cancelación en la interfaz (RF14, FR-038): la confirmación avisa si será tardía según la antelación
// de la barbería y, tras cancelar, la cita aparece cancelada.

type Cita = components['schemas']['Cita'];

const SLUG = 'barberia-huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };
const SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const INICIO = '2026-10-20T15:00:00Z';
const SELECCION = `servicio=${SERVICIO}&barbero=${BARBERO}&inicio=${encodeURIComponent(INICIO)}`;

const CITA: Cita = {
  id: '0190a1b2-c3d4-7e5f-8a9b-000000000099',
  barberia: 'Barbería Huamanga',
  servicio: 'Corte clásico',
  barbero: 'Carlos Ñaupa',
  inicio: '2026-10-20T10:00:00-05:00',
  fin: '2026-10-20T10:30:00-05:00',
  precio: '25.00',
  estado: 'CONFIRMADA',
  cancelacionTardia: false,
  cancelacionTardiaDesde: '2026-10-20T08:00:00-05:00',
  origen: 'EN_LINEA',
};

const sesion = (rol: 'CLIENTE' | 'PROPIETARIO') =>
  http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Luis',
        correo: 'luis@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );

/** Cliente con sesión en la barbería que acaba de reservar; `desde` decide si cancelar ahora sería tardío. */
function reservaHecha(desde: string) {
  const cancelaciones: unknown[] = [];
  servidor.use(
    sesion('CLIENTE'),
    http.get(`/api/v1/publico/${SLUG}`, () =>
      HttpResponse.json({
        barberia: {
          nombre: 'Barbería Huamanga',
          slug: SLUG,
          direccion: null,
          telefono: null,
          descripcion: null,
          zonaHoraria: 'America/Lima',
        },
        horario: { tramos: [] },
        servicios: [
          { id: SERVICIO, nombre: 'Corte clásico', descripcion: null, precio: '25.00', duracionMinutos: 30 },
        ],
        barberos: [{ id: BARBERO, nombre: 'Carlos Ñaupa', servicioIds: [SERVICIO] }],
      }),
    ),
    http.post('/api/v1/citas', () =>
      HttpResponse.json({ ...CITA, cancelacionTardiaDesde: desde }, { status: 201 }),
    ),
    http.post(`/api/v1/citas/${CITA.id}/cancelar`, async ({ request }) => {
      cancelaciones.push(await request.text());
      const tardia = Date.now() >= Date.parse(desde);
      return HttpResponse.json({
        ...CITA,
        cancelacionTardiaDesde: desde,
        estado: 'CANCELADA',
        cancelacionTardia: tardia,
      });
    }),
  );
  return cancelaciones;
}

function renderizar(
  ruta: string,
  contenido = (
    <Routes>
      <Route path="/b/:slug/reservar" element={<ReservarProtegida />} />
    </Routes>
  ),
) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>{contenido}</SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function reservarYAbrirCancelacion() {
  renderizar(`/b/${SLUG}/reservar?${SELECCION}`);
  const usuario = userEvent.setup();
  await usuario.click(await screen.findByRole('button', { name: /confirmar reserva/i }));
  const hecha = await screen.findByRole('region', { name: /tu cita está confirmada/i });
  await usuario.click(within(hecha).getByRole('button', { name: /cancelar cita/i }));
  return { usuario, modal: await screen.findByRole('alertdialog') };
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Cancelar desde la confirmación de la reserva (cliente)', () => {
  it('con menos antelación que la mínima avisa que será tardía y, al confirmar, la muestra cancelada y tardía', async () => {
    const cancelaciones = reservaHecha('2020-01-01T00:00:00-05:00');
    const { usuario, modal } = await reservarYAbrirCancelacion();
    expect(modal).toHaveTextContent(/quedará marcada como cancelación tardía/i);

    await usuario.click(within(modal).getByRole('button', { name: /sí, cancelar la cita/i }));
    const cancelada = await screen.findByRole('region', { name: /tu cita fue cancelada/i });
    expect(cancelada).toHaveTextContent(/cancelación tardía/i);
    expect(cancelada).toHaveTextContent('Corte clásico');
    expect(cancelaciones).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /cancelar cita/i })).not.toBeInTheDocument();
  });

  it('con antelación suficiente avisa que no será tardía; "Volver" no cancela nada', async () => {
    const cancelaciones = reservaHecha('2099-01-01T00:00:00-05:00');
    const { usuario, modal } = await reservarYAbrirCancelacion();
    expect(modal).toHaveTextContent(/no quedará como cancelación tardía/i);
    await usuario.click(within(modal).getByRole('button', { name: /volver/i }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cancelaciones).toHaveLength(0);
    expect(screen.getByRole('region', { name: /tu cita está confirmada/i })).toBeInTheDocument();
  });
});

describe('Cancelar desde la agenda (propietario)', () => {
  it('avisa que no será tardía para el cliente y, tras confirmar, la cita aparece cancelada', async () => {
    let cancelada = false;
    const futura = new Date(Date.now() + 3 * 60 * 60 * 1000);
    const iso = new Date(futura.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 19) + '-05:00';
    const deLaAgenda = () => ({
      ...CITA,
      inicio: iso,
      fin: iso,
      estado: cancelada ? 'CANCELADA' : 'CONFIRMADA',
      barberoId: BARBERO,
      cliente: { nombre: 'Rocío Huamaní', telefono: '977123456' },
      enConflicto: false,
    });
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/barberia', () =>
        HttpResponse.json({
          nombre: 'Barbería Huamanga',
          slug: SLUG,
          direccion: null,
          telefono: null,
          descripcion: null,
          zonaHoraria: 'America/Lima',
          antelacionCancelacionMinutos: 120,
        }),
      ),
      http.get('/api/v1/barberos', () => HttpResponse.json([])),
      http.get('/api/v1/agenda', ({ request }) =>
        HttpResponse.json({
          fecha: new URL(request.url).searchParams.get('fecha'),
          zonaHoraria: 'America/Lima',
          citas: [deLaAgenda()],
        }),
      ),
      http.post(`/api/v1/citas/${CITA.id}/cancelar`, () => {
        cancelada = true;
        return HttpResponse.json({ ...CITA, estado: 'CANCELADA' });
      }),
    );
    renderizar('/app/agenda', <RutasApp />);
    const fila = (await screen.findByText('Rocío Huamaní')).closest('li') as HTMLElement;
    const usuario = userEvent.setup();
    await usuario.click(within(fila).getByRole('button', { name: /cancelar/i }));
    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent(/no se marcará como tardía/i);
    await usuario.click(within(modal).getByRole('button', { name: /sí, cancelar la cita/i }));
    await screen.findByText(/cita cancelada/i);
    const filaDespues = (await screen.findByText('Rocío Huamaní')).closest('li') as HTMLElement;
    await within(filaDespues).findByText('Cancelada');
    expect(within(filaDespues).queryByRole('button', { name: /^cancelar$/i })).not.toBeInTheDocument();
  });
});
