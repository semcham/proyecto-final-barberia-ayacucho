import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { fechaIsoDeBarberia, horaDeBarberia } from '../../src/hora-barberia';
import { VERSION_POLITICA_DATOS } from '../../src/legal';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T103 · Agenda (RF16, RF15) y Clientes (FR-035) en el panel: lista por fecha con filtro y marcas, acciones
// de estado solo cuando la hora llegó, búsqueda y alta presencial con consentimiento obligatorio.

const ZONA = 'America/Lima';
const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'barberia-huamanga',
};
const PROPIETARIO = {
  id: '0190a1b2-0000-7000-8000-000000000001',
  nombre: 'Rosa Quispe',
  correo: 'rosa@prueba.pe',
};
const CARLOS = '0190a1b2-0000-7000-8000-0000000000b1';
const ANA = '0190a1b2-0000-7000-8000-0000000000b2';
const CORTE = '0190a1b2-0000-7000-8000-0000000000c1';
const HORA_MS = 60 * 60 * 1000;

const iso = (instante: Date) => {
  // Instante con el desplazamiento de Lima (UTC−5), como lo devuelve la API.
  const local = new Date(instante.getTime() - 5 * HORA_MS);
  return `${local.toISOString().slice(0, 19)}-05:00`;
};
const hoy = fechaIsoDeBarberia(new Date(), ZONA);
const pasada = new Date(Date.now() - 2 * HORA_MS);
const futura = new Date(Date.now() + 3 * HORA_MS);

const cita = (cambios: Record<string, unknown>) => ({
  id: 'c0',
  barberia: 'Barbería Huamanga',
  servicio: 'Corte clásico',
  barbero: 'Carlos Ñaupa',
  barberoId: CARLOS,
  inicio: iso(pasada),
  fin: iso(new Date(pasada.getTime() + HORA_MS / 2)),
  precio: '25.00',
  estado: 'CONFIRMADA',
  cancelacionTardia: false,
  origen: 'EN_LINEA',
  enConflicto: false,
  cliente: { nombre: 'Luis Huamán', telefono: '966111222' },
  ...cambios,
});

const CITAS = [
  cita({ id: 'c1' }),
  cita({
    id: 'c2',
    inicio: iso(futura),
    fin: iso(new Date(futura.getTime() + HORA_MS / 2)),
    enConflicto: true,
    cliente: { nombre: 'Rocío Huamaní', telefono: '977123456' },
    barbero: 'Ana',
    barberoId: ANA,
  }),
  cita({
    id: 'c3',
    estado: 'CANCELADA',
    cancelacionTardia: true,
    cliente: { nombre: 'Pedro Presencial', telefono: '922222222' },
    origen: 'PRESENCIAL',
  }),
];

function lecturas() {
  const pedidas: string[] = [];
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token-propietario',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: { ...PROPIETARIO, rol: 'PROPIETARIO', barberia: BARBERIA },
      }),
    ),
    http.get('/api/v1/barberia', () =>
      HttpResponse.json({
        nombre: 'Barbería Huamanga',
        slug: BARBERIA.slug,
        direccion: null,
        telefono: null,
        descripcion: null,
        zonaHoraria: ZONA,
        antelacionCancelacionMinutos: 120,
      }),
    ),
    http.get('/api/v1/barberos', () =>
      HttpResponse.json([
        { id: CARLOS, nombre: 'Carlos Ñaupa', activo: true, servicioIds: [CORTE], usuarioId: null },
        { id: ANA, nombre: 'Ana', activo: true, servicioIds: [CORTE], usuarioId: null },
      ]),
    ),
    http.get('/api/v1/servicios', () =>
      HttpResponse.json([
        {
          id: CORTE,
          nombre: 'Corte clásico',
          descripcion: null,
          precio: '25.00',
          duracionMinutos: 30,
          activo: true,
        },
      ]),
    ),
    http.get('/api/v1/agenda', ({ request }) => {
      const url = new URL(request.url);
      pedidas.push(url.search);
      return HttpResponse.json({ fecha: url.searchParams.get('fecha'), zonaHoraria: ZONA, citas: CITAS });
    }),
  );
  return pedidas;
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

const filaDe = async (cliente: string) => (await screen.findByText(cliente)).closest('li') as HTMLElement;

afterEach(() => tokenEnMemoria.limpiar());

describe('Agenda (/app/agenda)', () => {
  it('lista las citas del día con sus marcas y filtra por barbero y por fecha', async () => {
    const pedidas = lecturas();
    renderizar('/app/agenda');
    const enConflicto = await filaDe('Rocío Huamaní');
    expect(enConflicto).toHaveTextContent(/en conflicto/i);
    expect(enConflicto).toHaveTextContent(horaDeBarberia(futura, ZONA));
    expect(enConflicto).toHaveTextContent('977123456');
    const tardia = await filaDe('Pedro Presencial');
    expect(tardia).toHaveTextContent(/cancelada/i);
    expect(tardia).toHaveTextContent(/cancelación tardía/i);
    expect(pedidas[0]).toBe(`?fecha=${hoy}`);

    const usuario = userEvent.setup();
    await usuario.selectOptions(screen.getByLabelText(/^barbero$/i), 'Ana');
    await screen.findByText('Rocío Huamaní');
    expect(pedidas.at(-1)).toBe(`?fecha=${hoy}&barbero=${ANA}`);

    fireEvent.change(screen.getByLabelText(/^fecha$/i), { target: { value: '2026-11-03' } });
    await screen.findByText('Rocío Huamaní');
    expect(pedidas.at(-1)).toBe(`?fecha=2026-11-03&barbero=${ANA}`);
  });

  it('las acciones de estado solo aparecen cuando la hora de la cita llegó', async () => {
    lecturas();
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/citas/c1/estado', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json({ ...cita({ id: 'c1' }), estado: 'COMPLETADA' });
      }),
    );
    renderizar('/app/agenda');
    const futuraFila = await filaDe('Rocío Huamaní');
    expect(within(futuraFila).queryByRole('button', { name: /completar/i })).not.toBeInTheDocument();
    expect(within(futuraFila).queryByRole('button', { name: /no asistió/i })).not.toBeInTheDocument();
    const cancelada = await filaDe('Pedro Presencial');
    expect(within(cancelada).queryByRole('button', { name: /completar/i })).not.toBeInTheDocument();

    const pasadaFila = await filaDe('Luis Huamán');
    expect(within(pasadaFila).getByRole('button', { name: /no asistió/i })).toBeInTheDocument();
    await userEvent.setup().click(within(pasadaFila).getByRole('button', { name: /completar/i }));
    await screen.findByText(/cita completada/i);
    expect(cuerpo).toEqual({ estado: 'COMPLETADA' });
  });

  it('registra una cita presencial: elige al cliente, el servicio y una hora libre del día', async () => {
    lecturas();
    let cuerpo: unknown;
    let clave: string | null = null;
    servidor.use(
      http.get('/api/v1/clientes', () =>
        HttpResponse.json([{ id: 'k1', nombre: 'Rocío Huamaní', telefono: '977123456', origen: 'EN_LINEA' }]),
      ),
      http.get('/api/v1/horarios', ({ request }) => {
        const url = new URL(request.url);
        const fecha = url.searchParams.get('fecha') as string;
        return HttpResponse.json({
          fecha,
          zonaHoraria: ZONA,
          calculadoEn: `${fecha}T08:00:00-05:00`,
          servicioId: url.searchParams.get('servicio'),
          horas: [{ inicio: `${fecha}T23:00:00-05:00`, barberoIds: [ANA, CARLOS] }],
        });
      }),
      http.post('/api/v1/citas', async ({ request }) => {
        cuerpo = await request.json();
        clave = request.headers.get('Idempotency-Key');
        return HttpResponse.json({ ...cita({ id: 'nueva' }), origen: 'PRESENCIAL' }, { status: 201 });
      }),
    );
    renderizar('/app/agenda');
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /cita presencial/i }));
    const panel = screen.getByRole('region', { name: /nueva cita presencial/i });
    await usuario.type(within(panel).getByLabelText(/buscar cliente/i), 'ro');
    await usuario.click(await within(panel).findByRole('button', { name: /elegir a rocío huamaní/i }));
    await usuario.selectOptions(within(panel).getByLabelText(/^servicio$/i), 'Corte clásico');
    await usuario.click(await within(panel).findByRole('button', { name: '23:00' }));
    await usuario.click(within(panel).getByRole('button', { name: /registrar cita/i }));
    await screen.findByText(/cita registrada/i);
    expect(cuerpo).toEqual({
      servicioId: CORTE,
      barberoId: ANA,
      inicio: `${hoy}T23:00:00-05:00`,
      clienteId: 'k1',
    });
    expect(clave).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Clientes (/app/clientes)', () => {
  it('busca por nombre o teléfono', async () => {
    lecturas();
    const buscadas: (string | null)[] = [];
    servidor.use(
      http.get('/api/v1/clientes', ({ request }) => {
        buscadas.push(new URL(request.url).searchParams.get('buscar'));
        return HttpResponse.json([
          { id: 'k1', nombre: 'Rocío Huamaní', telefono: '977123456', origen: 'EN_LINEA' },
        ]);
      }),
    );
    renderizar('/app/clientes');
    await userEvent.setup().type(await screen.findByLabelText(/buscar por nombre o teléfono/i), 'ro');
    expect(await screen.findByText('Rocío Huamaní')).toBeInTheDocument();
    expect(screen.getByText('977123456')).toBeInTheDocument();
    expect(buscadas).toEqual(['ro']);
  });

  it('el alta presencial exige la casilla de consentimiento verbal y muestra la política', async () => {
    lecturas();
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/clientes', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json(
          { id: 'k2', nombre: 'Julia Ccorahua', telefono: '966555444', origen: 'PRESENCIAL' },
          { status: 201 },
        );
      }),
    );
    renderizar('/app/clientes');
    const formulario = await screen.findByRole('form', { name: /nuevo cliente presencial/i });
    expect(formulario).toHaveTextContent(new RegExp(`versión ${VERSION_POLITICA_DATOS}`));
    const usuario = userEvent.setup();
    await usuario.type(within(formulario).getByLabelText(/^nombre$/i), 'Julia Ccorahua');
    await usuario.type(within(formulario).getByLabelText(/teléfono/i), '966555444');
    await usuario.click(within(formulario).getByRole('button', { name: /registrar cliente/i }));
    expect(await within(formulario).findByText(/confirma que la persona aceptó/i)).toBeInTheDocument();
    expect(cuerpo).toBeUndefined();

    await usuario.click(within(formulario).getByLabelText(/aceptó verbalmente el tratamiento de sus datos/i));
    await usuario.click(within(formulario).getByRole('button', { name: /registrar cliente/i }));
    await screen.findByText(/cliente registrado/i);
    expect(cuerpo).toEqual({
      nombre: 'Julia Ccorahua',
      telefono: '966555444',
      correo: null,
      consentimientoVerbal: true,
      versionPoliticaDatos: VERSION_POLITICA_DATOS,
    });
  });
});
