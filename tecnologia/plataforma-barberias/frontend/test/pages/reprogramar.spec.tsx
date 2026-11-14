import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import type { components } from '../../src/api/schema-002';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { reprogramacion } from '../msw-handlers';
import { servidor } from '../setup';

// T045 · Reprogramar una cita en la interfaz (RF13; R15): desde Mis citas (cliente) y desde la Agenda
// (propietario), con la misma selección de hora del catálogo (SelectorDeHora). Estados cargando, vacío y error;
// 409 con la cita intacta; 422 sin antelación con la opción de cancelar; todo se puede hacer solo con teclado.

type Cita = components['schemas']['Cita'];

const SLUG = 'barberia-huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };
const SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const OTRO_BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000003';
const HORA_MS = 60 * 60 * 1000;
const enLima = (instante: Date) =>
  `${new Date(instante.getTime() - 5 * HORA_MS).toISOString().slice(0, 19)}-05:00`;

const INICIO = enLima(new Date(Date.now() + 48 * HORA_MS));
/** Fecha de la cita en la barbería (AAAA-MM-DD): el día que el diálogo muestra al abrir. */
const FECHA = INICIO.slice(0, 10);

const CITA: Cita = {
  id: '0190a1b2-c3d4-7e5f-8a9b-000000000099',
  barberia: 'Barbería Huamanga',
  servicio: 'Corte clásico',
  barbero: 'Carlos Ñaupa',
  inicio: INICIO,
  fin: enLima(new Date(Date.parse(INICIO) + 30 * 60_000)),
  precio: '25.00',
  estado: 'CONFIRMADA',
  cancelacionTardia: false,
  cancelacionTardiaDesde: enLima(new Date(Date.parse(INICIO) - 2 * HORA_MS)),
  origen: 'EN_LINEA',
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
  horario: { tramos: [] },
  servicios: [
    { id: SERVICIO, nombre: 'Corte clásico', descripcion: null, precio: '25.00', duracionMinutos: 30 },
  ],
  barberos: [
    { id: BARBERO, nombre: 'Carlos Ñaupa', servicioIds: [SERVICIO] },
    { id: OTRO_BARBERO, nombre: 'Rosa Quispe', servicioIds: [SERVICIO] },
  ],
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

/** GET /horarios: 10:00 y 10:30 con Carlos, 11:00 con Rosa, el día pedido. Guarda las consultas. */
function horariosLibres(consultas: string[] = []) {
  return http.get('/api/v1/horarios', ({ request }) => {
    const parametros = new URL(request.url).searchParams;
    consultas.push(parametros.toString());
    const fecha = parametros.get('fecha') as string;
    return HttpResponse.json({
      fecha,
      zonaHoraria: 'America/Lima',
      calculadoEn: new Date().toISOString(),
      servicioId: parametros.get('servicio'),
      horas: [
        { inicio: `${fecha}T10:00:00-05:00`, barberoIds: [BARBERO] },
        { inicio: `${fecha}T10:30:00-05:00`, barberoIds: [BARBERO] },
        { inicio: `${fecha}T11:00:00-05:00`, barberoIds: [OTRO_BARBERO] },
      ],
    });
  });
}

/** Cliente con sesión, su cita futura en Mis citas y el catálogo de su barbería. */
function clienteConCita(cita: Cita = CITA) {
  servidor.use(
    sesion('CLIENTE'),
    http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(CATALOGO)),
    http.get('/api/v1/clientes/yo/citas', () =>
      HttpResponse.json({ total: 1, pagina: 1, tamano: 10, elementos: [cita] }),
    ),
  );
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

const filaDe = async (texto: string) => (await screen.findByText(texto)).closest('li') as HTMLElement;

async function abrirDesdeMisCitas() {
  renderizar('/mis-citas');
  const usuario = userEvent.setup();
  await usuario.click(within(await filaDe('Corte clásico')).getByRole('button', { name: /reprogramar/i }));
  return { usuario, dialogo: await screen.findByRole('dialog', { name: /reprogramar la cita/i }) };
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Reprogramar desde Mis citas (cliente)', () => {
  it('elige una hora libre del día de la cita y la reprograma con el mismo servicio', async () => {
    clienteConCita();
    const consultas: string[] = [];
    const solicitudes: unknown[] = [];
    servidor.use(horariosLibres(consultas), reprogramacion.exito(CITA, solicitudes));
    const { usuario, dialogo } = await abrirDesdeMisCitas();

    expect(dialogo).toHaveTextContent('Corte clásico');
    const horas = await within(dialogo).findByRole('group', { name: /horas libres/i });
    // Por defecto, el barbero de la cita: solo sus horas.
    expect(
      within(horas)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['10:00', '10:30']);
    expect(consultas[0]).toContain(`servicio=${SERVICIO}`);
    expect(consultas[0]).toContain(`fecha=${FECHA}`);

    await usuario.click(within(horas).getByRole('button', { name: '10:30' }));
    await usuario.click(within(dialogo).getByRole('button', { name: /reprogramar a las 10:30/i }));

    expect(await screen.findByText(/cita reprogramada/i)).toBeInTheDocument();
    expect(solicitudes).toEqual([{ inicio: `${FECHA}T10:30:00-05:00`, barberoId: BARBERO }]);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('puede cambiar de barbero: ve las horas del otro barbero que ofrece el servicio', async () => {
    clienteConCita();
    const solicitudes: unknown[] = [];
    servidor.use(horariosLibres(), reprogramacion.exito(CITA, solicitudes));
    const { usuario, dialogo } = await abrirDesdeMisCitas();
    await within(dialogo).findByRole('group', { name: /horas libres/i });
    await usuario.selectOptions(within(dialogo).getByLabelText(/barbero/i), OTRO_BARBERO);
    const horas = within(dialogo).getByRole('group', { name: /horas libres/i });
    expect(
      within(horas)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['11:00']);
    await usuario.click(within(horas).getByRole('button', { name: '11:00' }));
    await usuario.click(within(dialogo).getByRole('button', { name: /reprogramar a las 11:00/i }));
    await screen.findByText(/cita reprogramada/i);
    expect(solicitudes).toEqual([{ inicio: `${FECHA}T11:00:00-05:00`, barberoId: OTRO_BARBERO }]);
  });

  it('muestra "cargando" mientras busca horas y "no hay horas libres ese día" si no hay', async () => {
    clienteConCita();
    servidor.use(
      http.get('/api/v1/horarios', async ({ request }) => {
        await delay(300);
        const fecha = new URL(request.url).searchParams.get('fecha');
        return HttpResponse.json({
          fecha,
          zonaHoraria: 'America/Lima',
          calculadoEn: new Date().toISOString(),
          servicioId: SERVICIO,
          horas: [],
        });
      }),
    );
    const { dialogo } = await abrirDesdeMisCitas();
    expect(await within(dialogo).findByText(/buscando horas libres/i)).toBeInTheDocument();
    expect(await within(dialogo).findByText(/no hay horas libres ese día/i)).toBeInTheDocument();
    expect(within(dialogo).queryByRole('button', { name: /reprogramar a las/i })).not.toBeInTheDocument();
  });

  it('si la consulta de horas falla, muestra el error', async () => {
    clienteConCita();
    servidor.use(
      http.get('/api/v1/horarios', () =>
        HttpResponse.json(
          { codigo: 'ERROR_INTERNO', mensaje: 'No pudimos calcular las horas libres.', detalles: [] },
          { status: 500 },
        ),
      ),
    );
    const { dialogo } = await abrirDesdeMisCitas();
    expect(await within(dialogo).findByRole('alert')).toBeInTheDocument();
  });

  it('409: avisa que la hora ya no está libre, vuelve a pedir las horas y la cita sigue igual', async () => {
    clienteConCita();
    const consultas: string[] = [];
    servidor.use(horariosLibres(consultas), reprogramacion.ocupada(CITA.id));
    const { usuario, dialogo } = await abrirDesdeMisCitas();
    const horas = await within(dialogo).findByRole('group', { name: /horas libres/i });
    await usuario.click(within(horas).getByRole('button', { name: '10:00' }));
    await usuario.click(within(dialogo).getByRole('button', { name: /reprogramar a las 10:00/i }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/ya no está disponible/i);
    expect(within(dialogo).getByRole('alert')).toHaveTextContent(/tu cita sigue/i);
    await within(dialogo).findByRole('group', { name: /horas libres/i });
    expect(consultas.length).toBeGreaterThanOrEqual(2);
    // La cita conserva su hora en la lista.
    expect(await filaDe('Corte clásico')).toHaveTextContent('Carlos Ñaupa');
    expect(screen.queryByText(/cita reprogramada/i)).not.toBeInTheDocument();
  });

  it('422 sin antelación: explica que ya no se puede reprogramar y ofrece cancelar la cita', async () => {
    clienteConCita();
    servidor.use(horariosLibres(), reprogramacion.sinAntelacion(CITA.id));
    const { usuario, dialogo } = await abrirDesdeMisCitas();
    const horas = await within(dialogo).findByRole('group', { name: /horas libres/i });
    await usuario.click(within(horas).getByRole('button', { name: '10:00' }));
    await usuario.click(within(dialogo).getByRole('button', { name: /reprogramar a las 10:00/i }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(/ya no se puede reprogramar/i);
    await usuario.click(within(dialogo).getByRole('button', { name: /cancelar la cita/i }));
    const confirmar = await screen.findByRole('alertdialog');
    expect(confirmar).toHaveTextContent(/¿cancelar la cita\?/i);
  });

  // T056 de 008 (research R11): si la cita espera su adelanto (p. ej., la lista estaba desactualizada), el servidor
  // responde 409 ADELANTO_PENDIENTE: se explica con su mensaje, sin pedir otras horas, y se ofrece cancelar.
  it('409 ADELANTO_PENDIENTE: explica que la cita espera su adelanto y ofrece cancelarla', async () => {
    clienteConCita();
    const consultas: string[] = [];
    servidor.use(
      horariosLibres(consultas),
      http.post(`/api/v1/citas/${CITA.id}/reprogramar`, () =>
        HttpResponse.json(
          {
            codigo: 'ADELANTO_PENDIENTE',
            mensaje: 'Esta cita espera el pago de su adelanto: paga y espera la confirmación, o cancela.',
            detalles: [],
          },
          { status: 409 },
        ),
      ),
    );
    const { usuario, dialogo } = await abrirDesdeMisCitas();
    const horas = await within(dialogo).findByRole('group', { name: /horas libres/i });
    await usuario.click(within(horas).getByRole('button', { name: '10:00' }));
    await usuario.click(within(dialogo).getByRole('button', { name: /reprogramar a las 10:00/i }));

    const alerta = await within(dialogo).findByRole('alert');
    expect(alerta).toHaveTextContent(
      'Esta cita espera el pago de su adelanto: paga y espera la confirmación, o cancela.',
    );
    expect(alerta).not.toHaveTextContent(/tu cita sigue/i);
    expect(consultas).toHaveLength(1);
    await usuario.click(within(dialogo).getByRole('button', { name: /cancelar la cita/i }));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(/¿cancelar la cita\?/i);
  });

  it('se completa solo con el teclado', async () => {
    clienteConCita();
    const solicitudes: unknown[] = [];
    servidor.use(horariosLibres(), reprogramacion.exito(CITA, solicitudes));
    renderizar('/mis-citas');
    await filaDe('Corte clásico');
    const usuario = userEvent.setup();

    /** Tabula hasta el control con ese nombre (como mucho 40 pasos). */
    const tabularHasta = async (nombre: RegExp) => {
      for (let i = 0; i < 40; i += 1) {
        await usuario.tab();
        const activo = document.activeElement as HTMLElement | null;
        if (activo && nombre.test(activo.getAttribute('aria-label') ?? activo.textContent ?? ''))
          return activo;
      }
      throw new Error(`No se llegó con Tab a ${nombre}`);
    };

    await tabularHasta(/^reprogramar$/i);
    await usuario.keyboard('{Enter}');
    const dialogo = await screen.findByRole('dialog', { name: /reprogramar la cita/i });
    await within(dialogo).findByRole('group', { name: /horas libres/i });
    await tabularHasta(/^10:00$/);
    await usuario.keyboard(' ');
    await tabularHasta(/reprogramar a las 10:00/i);
    await usuario.keyboard('{Enter}');
    expect(await screen.findByText(/cita reprogramada/i)).toBeInTheDocument();
    expect(solicitudes).toHaveLength(1);
  });

  it('las citas pasadas o canceladas no se pueden reprogramar', async () => {
    clienteConCita({ ...CITA, estado: 'CANCELADA' });
    renderizar('/mis-citas');
    const fila = await filaDe('Corte clásico');
    expect(within(fila).queryByRole('button', { name: /reprogramar/i })).not.toBeInTheDocument();
  });
});

describe('Reprogramar desde la Agenda (propietario)', () => {
  it('mueve la cita de un cliente a otro barbero y la agenda se actualiza', async () => {
    const solicitudes: unknown[] = [];
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
      http.get('/api/v1/barberos', () =>
        HttpResponse.json([
          { id: BARBERO, nombre: 'Carlos Ñaupa', activo: true, servicioIds: [SERVICIO] },
          { id: OTRO_BARBERO, nombre: 'Rosa Quispe', activo: true, servicioIds: [SERVICIO] },
        ]),
      ),
      http.get('/api/v1/servicios', () =>
        HttpResponse.json([
          {
            id: SERVICIO,
            nombre: 'Corte clásico',
            descripcion: null,
            precio: '25.00',
            duracionMinutos: 30,
            activo: true,
          },
        ]),
      ),
      http.get('/api/v1/agenda', ({ request }) =>
        HttpResponse.json({
          fecha: new URL(request.url).searchParams.get('fecha'),
          zonaHoraria: 'America/Lima',
          citas: [
            {
              ...CITA,
              barberoId: BARBERO,
              cliente: { nombre: 'Rocío Huamaní', telefono: '977123456' },
              enConflicto: false,
            },
          ],
        }),
      ),
      horariosLibres(),
      reprogramacion.exito(CITA, solicitudes),
    );
    renderizar('/app/agenda');
    const fila = (await screen.findByText('Rocío Huamaní')).closest('li') as HTMLElement;
    const usuario = userEvent.setup();
    await usuario.click(within(fila).getByRole('button', { name: /reprogramar/i }));
    const dialogo = await screen.findByRole('dialog', { name: /reprogramar la cita/i });
    await within(dialogo).findByRole('group', { name: /horas libres/i });
    await usuario.selectOptions(within(dialogo).getByLabelText(/barbero/i), OTRO_BARBERO);
    await usuario.click(within(dialogo).getByRole('button', { name: '11:00' }));
    await usuario.click(within(dialogo).getByRole('button', { name: /reprogramar a las 11:00/i }));
    expect(await screen.findByText(/cita reprogramada/i)).toBeInTheDocument();
    expect(solicitudes).toEqual([{ inicio: `${FECHA}T11:00:00-05:00`, barberoId: OTRO_BARBERO }]);
  });
});
