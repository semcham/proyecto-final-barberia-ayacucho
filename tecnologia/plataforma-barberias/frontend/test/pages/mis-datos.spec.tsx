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

// T007 de 007 · "Mis datos" del cliente (/mis-datos) y del barbero (/app/mis-datos; US1, FR-001, FR-002, FR-006):
// registran una solicitud de acceso, rectificación o eliminación sobre sus propios datos y ven su lista con el estado,
// el plazo y la respuesta. La rectificación sin detalle muestra el error junto al campo; un 409 muestra la existente;
// estado vacío. Los mensajes se anuncian (role="alert" o "status"). El propietario no ve "Mis datos"; el enlace
// "Mis datos" aparece en Mis citas.

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};
const BASE = '/api/v1/datos-personales/solicitudes';

const sesion = (rol: 'CLIENTE' | 'BARBERO' | 'PROPIETARIO') =>
  http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        correoVerificado: true,
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Ana',
        correo: 'ana@prueba.pe',
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

function solicitud(cambios: Solicitud = {}): Solicitud {
  return {
    id: '0193a000-0000-7000-8000-000000000001',
    tipo: 'ACCESO',
    estado: 'RECIBIDA',
    detalle: null,
    respuesta: null,
    motivo: null,
    recibidaEn: '2026-11-16T10:00:00-05:00',
    venceEl: '2026-11-30',
    vencida: false,
    enAtencionDesde: null,
    cerradaEn: null,
    enNombre: false,
    ...cambios,
  };
}

/** Servidor de "mis solicitudes": guarda lo recibido y responde con la respuesta dada (por defecto, 201). */
function servidorDeSolicitudes(
  iniciales: Solicitud[] = [],
  responder?: (cuerpo: Record<string, unknown>) => Response,
) {
  const lista = [...iniciales];
  const recibidos: Record<string, unknown>[] = [];
  servidor.use(
    http.get(`${BASE}/mias`, () => HttpResponse.json(lista)),
    http.post(BASE, async ({ request }) => {
      const cuerpo = (await request.json()) as Record<string, unknown>;
      recibidos.push(cuerpo);
      if (responder) return responder(cuerpo);
      const nueva = solicitud({ id: `0193a000-0000-7000-8000-00000000000${lista.length + 2}`, ...cuerpo });
      lista.push(nueva);
      return HttpResponse.json(nueva, { status: 201 });
    }),
  );
  return recibidos;
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

const titulo = () => screen.findByRole('heading', { level: 1, name: 'Mis datos' });

afterEach(() => tokenEnMemoria.limpiar());

describe('Mis datos del cliente (/mis-datos)', () => {
  it('sin solicitudes muestra el estado vacío', async () => {
    servidor.use(sesion('CLIENTE'));
    servidorDeSolicitudes();
    renderizar('/mis-datos');
    await titulo();
    expect(await screen.findByText(/aún no tienes solicitudes/i)).toBeInTheDocument();
  });

  it('registra una de acceso y la ve en su lista con el estado y el plazo', async () => {
    servidor.use(sesion('CLIENTE'));
    const recibidos = servidorDeSolicitudes();
    renderizar('/mis-datos');
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('radio', { name: /acceso/i }));
    await usuario.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/registramos tu solicitud/i);
    expect(recibidos).toEqual([{ tipo: 'ACCESO' }]);
    const lista = await screen.findByRole('list', { name: 'Mis solicitudes' });
    const [elemento] = within(lista).getAllByRole('listitem');
    expect(elemento).toHaveTextContent(/acceso a mis datos/i);
    expect(elemento).toHaveTextContent(/recibida/i);
    expect(elemento).toHaveTextContent(/30 de noviembre de 2026/i);
  });

  it('la rectificación sin detalle muestra el error junto al campo y no envía nada', async () => {
    servidor.use(sesion('CLIENTE'));
    const recibidos = servidorDeSolicitudes();
    renderizar('/mis-datos');
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('radio', { name: /rectificación/i }));
    await usuario.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    const detalle = screen.getByLabelText(/qué dato quieres corregir/i);
    expect(detalle).toHaveAttribute('aria-invalid', 'true');
    expect(detalle).toHaveAccessibleDescription(/escribe qué dato quieres corregir y cómo/i);
    expect(recibidos).toEqual([]);

    await usuario.type(detalle, 'Mi teléfono es 987654321');
    await usuario.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/registramos tu solicitud/i);
    expect(recibidos).toEqual([{ tipo: 'RECTIFICACION', detalle: 'Mi teléfono es 987654321' }]);
  });

  it('si ya tiene una abierta del mismo tipo, se lo dice y le señala la existente', async () => {
    servidor.use(sesion('CLIENTE'));
    servidorDeSolicitudes([solicitud()], () =>
      HttpResponse.json(
        {
          codigo: 'SOLICITUD_ABIERTA',
          mensaje: 'Ya tienes una solicitud abierta de este tipo.',
          detalles: [{ solicitudId: '0193a000-0000-7000-8000-000000000001' }],
        },
        { status: 409 },
      ),
    );
    renderizar('/mis-datos');
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('radio', { name: /acceso/i }));
    await usuario.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya tienes una solicitud de acceso abierta/i);
    const lista = screen.getByRole('list', { name: 'Mis solicitudes' });
    expect(within(lista).getAllByRole('listitem')).toHaveLength(1);
    expect(within(lista).getByText(/esta es la que ya tienes abierta/i)).toBeInTheDocument();
  });

  it('ve la respuesta de una atendida y el motivo de una rechazada', async () => {
    servidor.use(sesion('CLIENTE'));
    servidorDeSolicitudes([
      solicitud({ estado: 'ATENDIDA', respuesta: 'Te enviamos tus datos por correo.' }),
      solicitud({
        id: '0193a000-0000-7000-8000-000000000009',
        tipo: 'ELIMINACION',
        estado: 'RECHAZADA',
        motivo: 'Se conserva la auditoría',
      }),
    ]);
    renderizar('/mis-datos');
    await titulo();
    const lista = await screen.findByRole('list', { name: 'Mis solicitudes' });
    expect(lista).toHaveTextContent(/te enviamos tus datos por correo/i);
    expect(lista).toHaveTextContent(/rechazada/i);
    expect(lista).toHaveTextContent(/se conserva la auditoría/i);
  });

  it('se llega desde Mis citas con el enlace "Mis datos"', async () => {
    servidor.use(
      sesion('CLIENTE'),
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
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({ total: 0, pagina: 1, tamano: 10, elementos: [] }),
      ),
    );
    servidorDeSolicitudes();
    renderizar('/mis-citas');
    await userEvent.setup().click(await screen.findByRole('link', { name: 'Mis datos' }));
    expect(await titulo()).toBeInTheDocument();
  });
});

describe('Mis datos del barbero (/app/mis-datos)', () => {
  it('el barbero lo ve en el menú, registra una y la ve en su lista', async () => {
    servidor.use(sesion('BARBERO'), barberia);
    const recibidos = servidorDeSolicitudes();
    renderizar('/app/mis-datos');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).getByRole('link', { name: 'Mis datos' })).toHaveAttribute(
      'href',
      '/app/mis-datos',
    );
    expect(within(navegacion).queryByRole('link', { name: 'Solicitudes de datos' })).not.toBeInTheDocument();
    await titulo();
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('radio', { name: /eliminación/i }));
    await usuario.click(screen.getByRole('button', { name: /enviar solicitud/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/registramos tu solicitud/i);
    expect(recibidos).toEqual([{ tipo: 'ELIMINACION' }]);
  });

  it('el propietario no ve "Mis datos" en el menú ni la pantalla', async () => {
    const pedidos: string[] = [];
    servidor.use(
      sesion('PROPIETARIO'),
      barberia,
      http.get(`${BASE}/mias`, () => {
        pedidos.push('GET');
        return HttpResponse.json([]);
      }),
      http.get(BASE, () => HttpResponse.json([])),
    );
    renderizar('/app/mis-datos');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).queryByRole('link', { name: 'Mis datos' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Mis datos' })).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });
});
