import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import type { components } from '../../src/api/schema-002';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { fechaIsoDeBarberia } from '../../src/hora-barberia';
import CatalogoPublico from '../../src/pages/publico/CatalogoPublico';
import { servidor } from '../setup';

// T067 · Catálogo público por enlace (/b/:slug, RF10 y RF11): sin sesión, una solicitud para el catálogo y
// una por fecha, horas en la hora de la barbería y acceso a la reserva.

type Catalogo = components['schemas']['CatalogoPublico'];
type Horarios = components['schemas']['HorariosLibres'];

const SLUG = 'barberia-huamanga';
const CORTE = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBA = '0190a1b2-c3d4-7e5f-8a9b-000000000003';
const CARLOS = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const ROSA = '0190a1b2-c3d4-7e5f-8a9b-000000000004';
const ZONA = 'America/Lima';
const DIA_MS = 24 * 60 * 60 * 1000;
const fechaEnDias = (dias: number) => fechaIsoDeBarberia(new Date(Date.now() + dias * DIA_MS), ZONA);

const CATALOGO: Catalogo = {
  barberia: {
    nombre: 'Barbería Huamanga',
    slug: SLUG,
    direccion: 'Jr. Asamblea 120, Ayacucho',
    telefono: '066 312345',
    descripcion: 'Cortes clásicos y modernos.',
    zonaHoraria: ZONA,
  },
  horario: { tramos: [{ diaSemana: 2, inicio: '09:00', fin: '19:00' }] },
  servicios: [
    {
      id: CORTE,
      nombre: 'Corte clásico',
      descripcion: 'Con tijera y máquina.',
      precio: '25.00',
      duracionMinutos: 30,
    },
    { id: BARBA, nombre: 'Arreglo de barba', descripcion: null, precio: '15.00', duracionMinutos: 15 },
  ],
  barberos: [
    { id: CARLOS, nombre: 'Carlos Ñaupa', servicioIds: [CORTE, BARBA] },
    { id: ROSA, nombre: 'Rosa Quispe', servicioIds: [CORTE] },
  ],
};

/** 10:00 libre con los dos barberos; 10:15, solo con Rosa (hora de Lima = UTC−5). */
const horariosDe = (fecha: string, servicioId: string): Horarios => ({
  fecha,
  zonaHoraria: ZONA,
  calculadoEn: `${fecha}T08:00:00-05:00`,
  servicioId,
  horas: [
    { inicio: `${fecha}T10:00:00-05:00`, barberoIds: [CARLOS, ROSA] },
    { inicio: `${fecha}T10:15:00-05:00`, barberoIds: [ROSA] },
  ],
});

function RutaActual() {
  const { pathname, search } = useLocation();
  return <output data-testid="ruta">{pathname + search}</output>;
}

/** Pantalla de ingreso simulada: muestra a dónde volverá tras ingresar. */
function IngresoSimulado() {
  const estado = useLocation().state as { desde?: string } | null;
  return (
    <>
      <h1>Ingreso de cliente</h1>
      <output data-testid="desde">{estado?.desde}</output>
    </>
  );
}

function renderizar(ruta = `/b/${SLUG}`) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <Routes>
            <Route path="/b/:slug" element={<CatalogoPublico />} />
            <Route path="/b/:slug/registro" element={<h1>Registro de cliente</h1>} />
            <Route path="/b/:slug/ingresar" element={<IngresoSimulado />} />
            <Route path="/b/:slug/reservar" element={<h1>Reserva</h1>} />
          </Routes>
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Registra las solicitudes de la vía pública y responde con el catálogo y los horarios de prueba. */
function simularApi() {
  const solicitudes: string[] = [];
  servidor.use(
    http.get(`/api/v1/publico/${SLUG}`, ({ request }) => {
      solicitudes.push(new URL(request.url).pathname);
      return HttpResponse.json(CATALOGO);
    }),
    http.get(`/api/v1/publico/${SLUG}/horarios`, ({ request }) => {
      const url = new URL(request.url);
      solicitudes.push(url.pathname + url.search);
      return HttpResponse.json(
        horariosDe(url.searchParams.get('fecha') as string, url.searchParams.get('servicio') as string),
      );
    }),
  );
  return solicitudes;
}

const elegirFecha = (fecha: string) =>
  fireEvent.change(screen.getByLabelText(/fecha/i), { target: { value: fecha } });

afterEach(() => tokenEnMemoria.limpiar());

describe('Catálogo público (/b/:slug)', () => {
  it('muestra la barbería, sus servicios con precio y duración y sus barberos', async () => {
    indicadorSesion.quitar();
    simularApi();
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Barbería Huamanga' })).toBeInTheDocument();
    expect(screen.getByText('Jr. Asamblea 120, Ayacucho')).toBeInTheDocument();
    const servicios = screen.getByRole('radiogroup', { name: /servicio/i });
    expect(within(servicios).getByRole('radio', { name: /corte clásico/i })).toBeInTheDocument();
    expect(servicios).toHaveTextContent('S/ 25.00');
    expect(servicios).toHaveTextContent('30 min');
    expect(within(servicios).getByRole('radio', { name: /arreglo de barba/i })).toBeInTheDocument();
    const barberos = screen.getByRole('combobox', { name: /barbero/i });
    expect(within(barberos).getByRole('option', { name: /cualquier barbero/i })).toBeInTheDocument();
    expect(within(barberos).getByRole('option', { name: 'Carlos Ñaupa' })).toBeInTheDocument();
    expect(within(barberos).getByRole('option', { name: 'Rosa Quispe' })).toBeInTheDocument();
  });

  it('al elegir servicio y fecha pide los horarios una vez por fecha y los muestra en la hora de la barbería', async () => {
    indicadorSesion.quitar();
    const solicitudes = simularApi();
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('radio', { name: /corte clásico/i }));
    const fecha = fechaEnDias(3);
    elegirFecha(fecha);

    const horas = await screen.findByRole('group', { name: /horas libres/i });
    expect(within(horas).getByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(within(horas).getByRole('button', { name: '10:15' })).toBeInTheDocument();
    expect(screen.getAllByText(/hora de la barbería/i).length).toBeGreaterThan(0);

    // Elegir un barbero filtra en la interfaz, sin otra solicitud: 10:15 solo es de Rosa.
    await usuario.selectOptions(screen.getByRole('combobox', { name: /barbero/i }), 'Carlos Ñaupa');
    expect(within(horas).getByRole('button', { name: '10:00' })).toBeInTheDocument();
    expect(within(horas).queryByRole('button', { name: '10:15' })).not.toBeInTheDocument();

    // Una por fecha: hoy (la fecha por defecto al elegir el servicio) y la elegida; el barbero no pide nada.
    expect(solicitudes.filter((s) => s.includes('/horarios'))).toEqual([
      `/api/v1/publico/${SLUG}/horarios?servicio=${CORTE}&fecha=${fechaEnDias(0)}`,
      `/api/v1/publico/${SLUG}/horarios?servicio=${CORTE}&fecha=${fecha}`,
    ]);
    expect(solicitudes.filter((s) => !s.includes('/horarios'))).toHaveLength(1);

    // Otra fecha, otra solicitud.
    elegirFecha(fechaEnDias(4));
    await screen.findByRole('button', { name: '10:00' });
    expect(solicitudes.filter((s) => s.includes('/horarios'))).toHaveLength(3);
  });

  it('el selector de fecha se limita al horizonte de reserva desde hoy en la barbería', async () => {
    indicadorSesion.quitar();
    simularApi();
    renderizar();
    const campo = (await screen.findByLabelText(/fecha/i)) as HTMLInputElement;
    expect(campo.min).toBe(fechaEnDias(0));
    expect(campo.max).toBe(fechaEnDias(30));
  });

  it('un 404 muestra "barbería no disponible"', async () => {
    indicadorSesion.quitar();
    servidor.use(
      http.get(`/api/v1/publico/${SLUG}`, () =>
        HttpResponse.json(
          { codigo: 'BARBERIA_NO_DISPONIBLE', mensaje: 'Esta barbería no está disponible.', detalles: [] },
          { status: 404 },
        ),
      ),
    );
    renderizar();
    expect(await screen.findByRole('heading', { name: /barbería no disponible/i })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
  });

  it('sin sesión, reservar lleva al registro o al ingreso de la misma barbería con la selección', async () => {
    indicadorSesion.quitar();
    simularApi();
    const fecha = fechaEnDias(3);
    // Llega desde un 409 de la reserva: servicio y fecha ya elegidos, con el aviso.
    renderizar(`/b/${SLUG}?servicio=${CORTE}&fecha=${fecha}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: '10:15' }));

    const reservar = screen.getByRole('region', { name: /tu selección/i });
    expect(reservar).toHaveTextContent('Rosa Quispe');
    const destino = `/b/${SLUG}/reservar?servicio=${CORTE}&barbero=${ROSA}&inicio=${encodeURIComponent(`${fecha}T10:15:00-05:00`)}`;
    expect(within(reservar).getByRole('link', { name: /crear cuenta/i })).toHaveAttribute(
      'href',
      `/b/${SLUG}/registro`,
    );
    await usuario.click(within(reservar).getByRole('link', { name: /ya tengo cuenta/i }));
    expect(await screen.findByRole('heading', { name: /ingreso de cliente/i })).toBeInTheDocument();
    expect(screen.getByTestId('ruta').textContent).toBe(`/b/${SLUG}/ingresar`);
    // Tras ingresar vuelve directo a la confirmación de esa hora.
    expect(screen.getByTestId('desde').textContent).toBe(destino);
  });

  it('con sesión de cliente, reservar abre la confirmación con el primer barbero libre si se eligió "cualquiera"', async () => {
    simularApi();
    servidor.use(
      http.post('/api/v1/auth/refresh', () =>
        HttpResponse.json({
          tokenAcceso: 'token-cliente',
          tipo: 'Bearer',
          expiraEn: 900,
          usuario: {
            id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
            nombre: 'Luis Huamán',
            correo: 'luis@prueba.pe',
            rol: 'CLIENTE',
            barberia: { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG },
          },
        }),
      ),
    );
    const fecha = fechaEnDias(3);
    renderizar(`/b/${SLUG}?servicio=${CORTE}&fecha=${fecha}`);
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: '10:00' }));
    await usuario.click(screen.getByRole('button', { name: /reservar esta hora/i }));

    expect(await screen.findByRole('heading', { name: 'Reserva' })).toBeInTheDocument();
    const inicio = encodeURIComponent(`${fecha}T10:00:00-05:00`);
    expect(screen.getByTestId('ruta').textContent).toBe(
      `/b/${SLUG}/reservar?servicio=${CORTE}&barbero=${CARLOS}&inicio=${inicio}`,
    );
  });
});
