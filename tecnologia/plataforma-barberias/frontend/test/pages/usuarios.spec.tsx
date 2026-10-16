import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T102 · Página de usuarios (HU04): crear barbero con enlace, desactivar con confirmación y visibilidad por rol.

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
const BARBERO = {
  id: '0190a1b2-0000-7000-8000-000000000002',
  nombre: 'Luis Huamán',
  correo: 'luis@prueba.pe',
};

const sesionDe = (persona: typeof PROPIETARIO, rol: 'PROPIETARIO' | 'BARBERO') =>
  HttpResponse.json({
    tokenAcceso: `token-${rol}`,
    tipo: 'Bearer',
    expiraEn: 900,
    usuario: { ...persona, rol, barberia: BARBERIA },
  });

const usuario = (persona: typeof PROPIETARIO, rol: string, estado: string) => ({
  ...persona,
  rol,
  estado,
  creadoEn: '2026-10-15T15:00:00Z',
});

const LISTA = {
  datos: [usuario(PROPIETARIO, 'PROPIETARIO', 'ACTIVA'), usuario(BARBERO, 'BARBERO', 'ACTIVA')],
  total: 2,
  pagina: 1,
  tamano: 20,
};

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

describe('Página de usuarios', () => {
  afterEach(() => {
    tokenEnMemoria.limpiar();
    vi.restoreAllMocks();
  });

  it('crear un barbero muestra el enlace de activación con botón para copiarlo', async () => {
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/auth/refresh', () => sesionDe(PROPIETARIO, 'PROPIETARIO')),
      http.get('/api/v1/usuarios', () => HttpResponse.json(LISTA)),
      http.post('/api/v1/usuarios', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json(
          {
            usuario: usuario(
              { id: 'nuevo', nombre: 'Ana Pérez', correo: 'ana@prueba.pe' },
              'BARBERO',
              'PENDIENTE',
            ),
            activacion: {
              enlace: 'http://localhost:5173/activar?token=abc123',
              venceEn: '2026-10-18T15:00:00Z',
            },
          },
          { status: 201 },
        );
      }),
    );
    renderizar('/app/usuarios');
    const persona = userEvent.setup();
    await persona.type(await screen.findByLabelText(/^nombre$/i), 'Ana Pérez');
    await persona.type(screen.getByLabelText(/^correo$/i), 'ana@prueba.pe');
    await persona.click(screen.getByRole('button', { name: /crear barbero/i }));

    const dialogo = await screen.findByRole('dialog', { name: /enlace de activación/i });
    expect(within(dialogo).getByLabelText(/enlace de activación/i)).toHaveValue(
      'http://localhost:5173/activar?token=abc123',
    );
    expect(cuerpo).toEqual({ nombre: 'Ana Pérez', correo: 'ana@prueba.pe', rol: 'BARBERO' });

    await persona.click(within(dialogo).getByRole('button', { name: /copiar enlace/i }));
    expect(await navigator.clipboard.readText()).toBe('http://localhost:5173/activar?token=abc123');
    expect(within(dialogo).getByRole('button', { name: /copiado/i })).toBeInTheDocument();
  });

  it('desactivar desde el menú de la fila pide confirmación y solo envía el cambio si se confirma', async () => {
    const cambios: unknown[] = [];
    servidor.use(
      http.post('/api/v1/auth/refresh', () => sesionDe(PROPIETARIO, 'PROPIETARIO')),
      http.get('/api/v1/usuarios', () => HttpResponse.json(LISTA)),
      http.patch('/api/v1/usuarios/:id', async ({ request, params }) => {
        cambios.push({ id: params.id, ...((await request.json()) as Record<string, unknown>) });
        return HttpResponse.json(usuario(BARBERO, 'BARBERO', 'DESACTIVADA'));
      }),
    );
    renderizar('/app/usuarios');
    const persona = userEvent.setup();
    const filaBarbero = (await screen.findByText(BARBERO.nombre)).closest('li') as HTMLElement;
    const abrirDesactivar = async () => {
      await persona.click(within(filaBarbero).getByRole('button', { name: /acciones para luis huamán/i }));
      await persona.click(await screen.findByRole('menuitem', { name: /desactivar/i }));
      return screen.findByRole('alertdialog', { name: /desactivar a luis huamán/i });
    };

    // Cancelar no envía nada.
    let confirmacion = await abrirDesactivar();
    await persona.click(within(confirmacion).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cambios).toEqual([]);

    // Confirmar envía el cambio y muestra un aviso de éxito.
    confirmacion = await abrirDesactivar();
    await persona.click(within(confirmacion).getByRole('button', { name: /sí, desactivar/i }));
    await vi.waitFor(() => expect(cambios).toEqual([{ id: BARBERO.id, estado: 'DESACTIVADA' }]));
    expect(await screen.findByText(/cuenta de luis huamán desactivada/i)).toBeInTheDocument();
  });

  it('la búsqueda filtra por nombre o correo sin distinguir tildes', async () => {
    servidor.use(
      http.post('/api/v1/auth/refresh', () => sesionDe(PROPIETARIO, 'PROPIETARIO')),
      http.get('/api/v1/usuarios', () => HttpResponse.json(LISTA)),
    );
    renderizar('/app/usuarios');
    const persona = userEvent.setup();
    await screen.findByText(BARBERO.nombre);

    await persona.type(screen.getByRole('searchbox', { name: /buscar/i }), 'huaman');
    const lista = screen.getByRole('list', { name: /usuarios de la barbería/i });
    expect(within(lista).getByText(BARBERO.nombre)).toBeInTheDocument();
    expect(within(lista).queryByText(PROPIETARIO.nombre)).not.toBeInTheDocument();

    await persona.clear(screen.getByRole('searchbox', { name: /buscar/i }));
    await persona.type(screen.getByRole('searchbox', { name: /buscar/i }), 'nadie');
    expect(screen.getByText(/sin resultados/i)).toBeInTheDocument();
  });

  it('el propietario no ve acciones sobre su propia fila', async () => {
    servidor.use(
      http.post('/api/v1/auth/refresh', () => sesionDe(PROPIETARIO, 'PROPIETARIO')),
      http.get('/api/v1/usuarios', () => HttpResponse.json(LISTA)),
    );
    renderizar('/app/usuarios');
    const filaPropietario = (await screen.findByText(PROPIETARIO.correo)).closest('li') as HTMLElement;
    expect(within(filaPropietario).queryByRole('button')).not.toBeInTheDocument();
  });

  it('muestra el límite del plan cuando no se pueden crear más usuarios', async () => {
    servidor.use(
      http.post('/api/v1/auth/refresh', () => sesionDe(PROPIETARIO, 'PROPIETARIO')),
      http.get('/api/v1/usuarios', () => HttpResponse.json(LISTA)),
      http.post('/api/v1/usuarios', () =>
        HttpResponse.json(
          {
            codigo: 'SUSCRIPCION_NO_PERMITE',
            mensaje: 'Tu plan no permite agregar más usuarios.',
            detalles: [{ motivo: 'LIMITE_USUARIOS', maximo: 5 }],
          },
          { status: 403 },
        ),
      ),
    );
    renderizar('/app/usuarios');
    const persona = userEvent.setup();
    await persona.type(await screen.findByLabelText(/^nombre$/i), 'Ana Pérez');
    await persona.type(screen.getByLabelText(/^correo$/i), 'ana@prueba.pe');
    await persona.click(screen.getByRole('button', { name: /crear barbero/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tu plan permite hasta 5 usuarios');
  });

  it('un barbero no ve el menú de usuarios ni puede abrir la página', async () => {
    servidor.use(http.post('/api/v1/auth/refresh', () => sesionDe(BARBERO, 'BARBERO')));
    renderizar('/app/usuarios');
    // RutaProtegida lo lleva a /app.
    expect(await screen.findByRole('navigation', { name: /principal/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /usuarios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^usuarios$/i })).not.toBeInTheDocument();
  });
});
