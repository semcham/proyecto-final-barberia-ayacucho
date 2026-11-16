import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T007 de 007 · Bandeja del propietario (/app/solicitudes-datos; US1, FR-003 a FR-008): ve las solicitudes de su
// barbería con el titular, el plazo y si están vencidas; filtra por estado; inicia la atención, atiende con una
// respuesta o rechaza con un motivo (el error, junto al campo); registra una en nombre de un cliente. Los mensajes se
// anuncian (role="status" o "alert"). El barbero y el cliente no ven la bandeja.

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};
const BASE = '/api/v1/datos-personales/solicitudes';

const sesion = (rol: 'PROPIETARIO' | 'BARBERO' | 'CLIENTE') =>
  http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Rosa Quispe',
        correo: 'rosa@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );

const barberia = http.get('/api/v1/barberia', () =>
  HttpResponse.json({
    ...BARBERIA,
    direccion: null,
    telefono: null,
    descripcion: null,
    zonaHoraria: 'America/Lima',
    antelacionCancelacionMinutos: 120,
  }),
);

type Solicitud = Record<string, unknown>;

function enBandeja(cambios: Solicitud = {}): Solicitud {
  return {
    id: '0193a000-0000-7000-8000-000000000001',
    tipo: 'RECTIFICACION',
    estado: 'RECIBIDA',
    detalle: 'Mi teléfono es 987654321',
    respuesta: null,
    motivo: null,
    recibidaEn: '2026-11-16T10:00:00-05:00',
    venceEl: '2026-11-30',
    vencida: false,
    enAtencionDesde: null,
    cerradaEn: null,
    enNombre: false,
    titular: { tipo: 'CLIENTE', nombre: 'Ana Clienta' },
    ...cambios,
  };
}

interface Pedido {
  metodo: string;
  ruta: string;
  cuerpo?: unknown;
}

/** Servidor de la bandeja: guarda cada pedido y aplica las transiciones sobre la lista. */
function servidorDeBandeja(inicial: Solicitud[]) {
  let lista = [...inicial];
  const pedidos: Pedido[] = [];
  const cambiar = (id: string, cambios: Solicitud) => {
    lista = lista.map((s) => (s.id === id ? { ...s, ...cambios } : s));
    return lista.find((s) => s.id === id);
  };
  servidor.use(
    sesion('PROPIETARIO'),
    barberia,
    http.get(BASE, ({ request }) => {
      const estado = new URL(request.url).searchParams.get('estado');
      pedidos.push({ metodo: 'GET', ruta: `${BASE}${estado ? `?estado=${estado}` : ''}` });
      const abiertas = (s: Solicitud) => s.estado === 'RECIBIDA' || s.estado === 'EN_ATENCION';
      return HttpResponse.json(
        lista.filter((s) => (!estado || estado === 'ABIERTAS' ? abiertas(s) : s.estado === estado)),
      );
    }),
    http.post(`${BASE}/:id/atencion`, ({ params }) => {
      pedidos.push({ metodo: 'POST', ruta: `atencion:${String(params.id)}` });
      return HttpResponse.json(cambiar(String(params.id), { estado: 'EN_ATENCION' }));
    }),
    http.post(`${BASE}/:id/cierre`, async ({ params, request }) => {
      const cuerpo = (await request.json()) as Record<string, string>;
      pedidos.push({ metodo: 'POST', ruta: `cierre:${String(params.id)}`, cuerpo });
      return HttpResponse.json(
        cambiar(String(params.id), {
          estado: cuerpo.resultado,
          respuesta: cuerpo.respuesta ?? null,
          motivo: cuerpo.motivo ?? null,
        }),
      );
    }),
  );
  return pedidos;
}

function renderizar(ruta = '/app/solicitudes-datos') {
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

const titulo = () => screen.findByRole('heading', { level: 1, name: 'Solicitudes de datos' });

afterEach(() => tokenEnMemoria.limpiar());

describe('Solicitudes de datos (/app/solicitudes-datos)', () => {
  it('el propietario la ve en el menú y no ve "Mis datos"', async () => {
    servidorDeBandeja([]);
    renderizar('/app');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).getByRole('link', { name: 'Solicitudes de datos' })).toHaveAttribute(
      'href',
      '/app/solicitudes-datos',
    );
    expect(within(navegacion).queryByRole('link', { name: 'Mis datos' })).not.toBeInTheDocument();
  });

  it('sin solicitudes abiertas muestra el estado vacío', async () => {
    servidorDeBandeja([]);
    renderizar();
    await titulo();
    expect(await screen.findByText(/no hay solicitudes abiertas/i)).toBeInTheDocument();
  });

  it('muestra el titular, el tipo, el detalle, el plazo y si está vencida', async () => {
    servidorDeBandeja([
      enBandeja(),
      enBandeja({
        id: '0193a000-0000-7000-8000-000000000002',
        tipo: 'ELIMINACION',
        detalle: null,
        venceEl: '2026-11-02',
        vencida: true,
        titular: { tipo: 'BARBERO', nombre: 'Luis Barbero' },
      }),
    ]);
    renderizar();
    await titulo();
    const lista = await screen.findByRole('list', { name: 'Solicitudes' });
    const [ana, luis] = within(lista).getAllByRole('listitem');
    expect(ana).toHaveTextContent('Ana Clienta');
    expect(ana).toHaveTextContent(/cliente/i);
    expect(ana).toHaveTextContent(/rectificación/i);
    expect(ana).toHaveTextContent('Mi teléfono es 987654321');
    expect(ana).toHaveTextContent(/30 de noviembre de 2026/i);
    expect(ana).not.toHaveTextContent(/vencida/i);
    expect(luis).toHaveTextContent('Luis Barbero');
    expect(luis).toHaveTextContent(/barbero/i);
    expect(luis).toHaveTextContent(/vencida/i);
  });

  it('filtra por estado', async () => {
    const pedidos = servidorDeBandeja([enBandeja({ estado: 'ATENDIDA', respuesta: 'Hecho.' })]);
    renderizar();
    await titulo();
    await screen.findByText(/no hay solicitudes abiertas/i);
    await userEvent.setup().selectOptions(screen.getByLabelText('Estado'), 'ATENDIDA');
    const lista = await screen.findByRole('list', { name: 'Solicitudes' });
    expect(lista).toHaveTextContent(/atendida/i);
    expect(lista).toHaveTextContent('Hecho.');
    expect(pedidos.map((p) => p.ruta)).toContain(`${BASE}?estado=ATENDIDA`);
  });

  it('inicia la atención y luego atiende con una respuesta; sin respuesta, el error va junto al campo', async () => {
    const pedidos = servidorDeBandeja([enBandeja()]);
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /iniciar atención/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/quedó en atención/i);

    await usuario.click(await screen.findByRole('button', { name: /^atender/i }));
    const dialogo = await screen.findByRole('dialog');
    await usuario.click(within(dialogo).getByRole('button', { name: /marcar como atendida/i }));
    const respuesta = within(dialogo).getByLabelText('Respuesta');
    expect(respuesta).toHaveAttribute('aria-invalid', 'true');
    expect(respuesta).toHaveAccessibleDescription(/escribe qué hiciste/i);
    await usuario.type(respuesta, 'Corregí el teléfono a mano.');
    await usuario.click(within(dialogo).getByRole('button', { name: /marcar como atendida/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/quedó atendida/i);
    expect(pedidos.filter((p) => p.metodo === 'POST')).toEqual([
      { metodo: 'POST', ruta: 'atencion:0193a000-0000-7000-8000-000000000001' },
      {
        metodo: 'POST',
        ruta: 'cierre:0193a000-0000-7000-8000-000000000001',
        cuerpo: { resultado: 'ATENDIDA', respuesta: 'Corregí el teléfono a mano.' },
      },
    ]);
  });

  it('rechaza con un motivo de 5 a 300 caracteres', async () => {
    const pedidos = servidorDeBandeja([enBandeja()]);
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /^rechazar/i }));
    const dialogo = await screen.findByRole('dialog');
    const motivo = within(dialogo).getByLabelText('Motivo del rechazo');
    await usuario.type(motivo, 'no');
    await usuario.click(within(dialogo).getByRole('button', { name: /rechazar solicitud/i }));
    expect(motivo).toHaveAttribute('aria-invalid', 'true');
    await usuario.clear(motivo);
    await usuario.type(motivo, 'No es titular de la cuenta');
    await usuario.click(within(dialogo).getByRole('button', { name: /rechazar solicitud/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/quedó rechazada/i);
    expect(pedidos.filter((p) => p.metodo === 'POST')).toEqual([
      {
        metodo: 'POST',
        ruta: 'cierre:0193a000-0000-7000-8000-000000000001',
        cuerpo: { resultado: 'RECHAZADA', motivo: 'No es titular de la cuenta' },
      },
    ]);
  });

  it('registra una en nombre de un cliente que busca por nombre', async () => {
    servidorDeBandeja([]);
    const recibidos: unknown[] = [];
    servidor.use(
      http.get('/api/v1/clientes', () =>
        HttpResponse.json([
          {
            id: '0193a000-0000-7000-8000-0000000000c1',
            nombre: 'Pedro Presencial',
            telefono: '987000111',
            origen: 'PRESENCIAL',
          },
        ]),
      ),
      http.post(`${BASE}/en-nombre`, async ({ request }) => {
        recibidos.push(await request.json());
        return HttpResponse.json(enBandeja({ enNombre: true, tipo: 'ACCESO', detalle: null }), {
          status: 201,
        });
      }),
    );
    renderizar();
    await titulo();
    const usuario = userEvent.setup();
    const seccion = screen.getByRole('region', { name: /registrar en nombre de un cliente/i });
    await usuario.type(within(seccion).getByLabelText('Buscar cliente'), 'Pedro');
    await usuario.click(within(seccion).getByRole('button', { name: /buscar/i }));
    await usuario.click(await within(seccion).findByRole('radio', { name: /pedro presencial/i }));
    await usuario.click(within(seccion).getByRole('radio', { name: /acceso/i }));
    await usuario.click(within(seccion).getByRole('button', { name: /registrar solicitud/i }));
    expect(await within(seccion).findByRole('status')).toHaveTextContent(/registramos la solicitud/i);
    expect(recibidos).toEqual([{ tipo: 'ACCESO', clienteId: '0193a000-0000-7000-8000-0000000000c1' }]);
  });

  it.each(['BARBERO', 'CLIENTE'] as const)('el %s no ve la bandeja ni la pide', async (rol) => {
    const pedidos: string[] = [];
    servidor.use(
      sesion(rol),
      barberia,
      http.get(BASE, () => {
        pedidos.push('GET');
        return HttpResponse.json([]);
      }),
      http.get(`${BASE}/mias`, () => HttpResponse.json([])),
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({ total: 0, pagina: 1, tamano: 10, elementos: [] }),
      ),
      http.get('/api/v1/publico/huamanga', () =>
        HttpResponse.json({
          barberia: {
            ...BARBERIA,
            direccion: null,
            telefono: null,
            descripcion: null,
            zonaHoraria: 'America/Lima',
          },
          horario: { tramos: [] },
          servicios: [],
          barberos: [],
        }),
      ),
    );
    renderizar();
    await new Promise((r) => setTimeout(r, 300));
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('heading', { level: 1, name: 'Solicitudes de datos' })).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });
});
