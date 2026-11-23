import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { RutaProtegida } from '../../src/auth/RutaProtegida';
import { SesionProvider } from '../../src/auth/SesionProvider';
import ClienteSinSesion from '../../src/pages/cliente/ClienteSinSesion';
import { RutasApp } from '../../src/routes';
import { ultimaBarberia } from '../../src/ultima-barberia';
import { servidor } from '../setup';

// /mis-citas sin sesión: en vez de llevar a /ingresar (el ingreso del personal, donde un cliente solo leería
// "Ingresa desde el enlace de tu barbería"), ofrece "Ingresar" en la última barbería abierta en este navegador o
// explica cómo llegar a ella. La ruta igual que en routes.tsx: RutaProtegida con `sinSesion`.

const SLUG = 'barberia-huamanga';
const CLAVE = 'barberias.ultimaBarberia';
const SESION_CLIENTE = {
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
};

function IngresoSimulado() {
  const estado = useLocation().state as { desde?: string } | null;
  return (
    <>
      <h1>Ingreso de cliente</h1>
      <output data-testid="desde">{estado?.desde}</output>
    </>
  );
}

function RutaActual() {
  const { pathname } = useLocation();
  return <output data-testid="ruta">{pathname}</output>;
}

function renderizar(ruta = '/mis-citas') {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <Routes>
            <Route
              path="/mis-citas"
              element={
                <RutaProtegida
                  roles={['CLIENTE']}
                  sinSesion={(desde) => <ClienteSinSesion pantalla="mis-citas" desde={desde} />}
                >
                  <h1>Historial del cliente</h1>
                </RutaProtegida>
              }
            />
            <Route path="/ingresar" element={<h1>Ingreso del personal</h1>} />
            <Route path="/app" element={<h1>Panel</h1>} />
            <Route path="/b/:slug" element={<h1>Página de la barbería</h1>} />
            <Route path="/b/:slug/ingresar" element={<IngresoSimulado />} />
          </Routes>
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  tokenEnMemoria.limpiar();
  ultimaBarberia.olvidar();
  vi.restoreAllMocks();
});

describe('/mis-citas sin sesión', () => {
  it('con una barbería recordada ofrece "Ingresar" en ella y, tras ingresar, vuelve a /mis-citas', async () => {
    indicadorSesion.quitar();
    ultimaBarberia.guardar({ slug: SLUG, nombre: 'Barbería Huamanga' });
    renderizar();

    expect(await screen.findByRole('heading', { level: 1, name: 'Mis citas' })).toBeInTheDocument();
    expect(screen.getByText('Barbería Huamanga')).toBeInTheDocument();
    // No redirige al ingreso del personal.
    expect(screen.getByTestId('ruta').textContent).toBe('/mis-citas');
    expect(screen.getByRole('link', { name: 'Ver la página de la barbería' })).toHaveAttribute(
      'href',
      `/b/${SLUG}`,
    );

    const ingresar = screen.getByRole('link', { name: 'Ingresar' });
    expect(ingresar).toHaveAttribute('href', `/b/${SLUG}/ingresar`);
    await userEvent.setup().click(ingresar);
    expect(await screen.findByRole('heading', { name: 'Ingreso de cliente' })).toBeInTheDocument();
    expect(screen.getByTestId('desde').textContent).toBe('/mis-citas');
  });

  it('sin barbería recordada explica cómo llegar a la página de su barbería', async () => {
    indicadorSesion.quitar();
    renderizar();

    expect(await screen.findByRole('heading', { level: 1, name: 'Mis citas' })).toBeInTheDocument();
    expect(screen.getByText(/abre el enlace de tu barbería/i)).toBeInTheDocument();
    expect(screen.getByText(/pulsa «ingresar»/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument();
    // El personal tiene su propio ingreso.
    expect(screen.getByRole('link', { name: /ingresa al panel/i })).toHaveAttribute('href', '/ingresar');
    expect(screen.getByTestId('ruta').textContent).toBe('/mis-citas');
  });

  it('un valor guardado inválido o manipulado se ignora y se muestra la explicación', async () => {
    indicadorSesion.quitar();
    localStorage.setItem(CLAVE, JSON.stringify({ slug: '../../app', nombre: 'Falsa' }));
    renderizar();
    expect(await screen.findByText(/abre el enlace de tu barbería/i)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument();
  });

  it('si el almacenamiento del navegador falla, la pantalla funciona igual (explicación)', async () => {
    indicadorSesion.quitar();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('almacenamiento bloqueado');
    });
    renderizar();
    expect(await screen.findByText(/abre el enlace de tu barbería/i)).toBeInTheDocument();
  });

  it('con sesión de cliente muestra su historial, sin la pantalla de ingreso', async () => {
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
    renderizar();
    expect(await screen.findByRole('heading', { name: 'Historial del cliente' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument();
  });
});

// T019 de 010 (US4; FR-028, FR-029): las demás pantallas del cliente se comportan como /mis-citas. Con las rutas reales
// de la aplicación (RutasApp), para fijar también que cada ruta usa `sinSesion`.
const CITA_ID = '0190a1b2-c3d4-7e5f-8a9b-000000000099';
const PANTALLAS: { ruta: string; titulo: string; ultimoPaso: RegExp }[] = [
  { ruta: '/asistente', titulo: 'Asistente', ultimoPaso: /«preguntar al asistente»/i },
  { ruta: '/mis-avisos', titulo: 'Cómo recibo mis avisos', ultimoPaso: /«cómo recibo mis avisos»/i },
  { ruta: '/mis-datos', titulo: 'Mis datos', ultimoPaso: /«mis datos»/i },
  { ruta: `/mis-citas/${CITA_ID}/adelanto`, titulo: 'Pagar adelanto', ultimoPaso: /«pagar adelanto»/i },
];

function renderizarApp(ruta: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Las demás pantallas del cliente sin sesión (010, US4)', () => {
  it.each(PANTALLAS)(
    '$ruta sin barbería recordada explica cómo llegar, sin llevar a /ingresar',
    async ({ ruta, titulo, ultimoPaso }) => {
      indicadorSesion.quitar();
      renderizarApp(ruta);
      expect(await screen.findByRole('heading', { level: 1, name: titulo })).toBeInTheDocument();
      expect(screen.getByText(/abre el enlace de tu barbería/i)).toBeInTheDocument();
      expect(screen.getByText(ultimoPaso)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument();
      expect(screen.getByTestId('ruta').textContent).toBe(ruta);
    },
  );

  it.each(PANTALLAS)(
    '$ruta con barbería recordada ofrece "Ingresar" en ella y, tras ingresar, vuelve a $ruta',
    async ({ ruta, titulo }) => {
      indicadorSesion.quitar();
      ultimaBarberia.guardar({ slug: SLUG, nombre: 'Barbería Huamanga' });
      // Ya con sesión, la pantalla pedida consulta la API: aquí basta con que responda (con un error). MSW usa el
      // primer manejador que coincide, así que el del ingreso va antes que el genérico.
      servidor.use(
        http.post('/api/v1/auth/login', () => HttpResponse.json(SESION_CLIENTE)),
        http.all('/api/v1/*', () =>
          HttpResponse.json(
            { codigo: 'NO_DISPONIBLE', mensaje: 'Sin datos en esta prueba.', detalles: [] },
            { status: 503 },
          ),
        ),
      );
      renderizarApp(ruta);

      expect(await screen.findByRole('heading', { level: 1, name: titulo })).toBeInTheDocument();
      expect(screen.getByText('Barbería Huamanga')).toBeInTheDocument();
      expect(screen.getByTestId('ruta').textContent).toBe(ruta);

      const usuario = userEvent.setup();
      const ingresar = screen.getByRole('link', { name: 'Ingresar' });
      expect(ingresar).toHaveAttribute('href', `/b/${SLUG}/ingresar`);
      await usuario.click(ingresar);
      await usuario.type(await screen.findByLabelText(/correo/i), 'luis@prueba.pe');
      await usuario.type(screen.getByLabelText(/contraseña/i), 'mi corte de los sabados');
      await usuario.click(screen.getByRole('button', { name: /^ingresar$/i }));

      await waitFor(() => expect(screen.getByTestId('ruta').textContent).toBe(ruta));
      expect(screen.queryByRole('link', { name: 'Ingresar' })).not.toBeInTheDocument();
    },
  );
});

describe('ultimaBarberia (almacenamiento ligero en el navegador)', () => {
  it('guarda y lee solo el enlace y el nombre', () => {
    ultimaBarberia.guardar({ slug: SLUG, nombre: 'Barbería Huamanga' });
    expect(JSON.parse(localStorage.getItem(CLAVE) as string)).toEqual({
      slug: SLUG,
      nombre: 'Barbería Huamanga',
    });
    expect(ultimaBarberia.leer()).toEqual({ slug: SLUG, nombre: 'Barbería Huamanga' });
  });

  it('no guarda un enlace con formato inválido', () => {
    ultimaBarberia.guardar({ slug: 'Con Espacios', nombre: 'X' });
    expect(localStorage.getItem(CLAVE)).toBeNull();
  });

  it('un JSON roto se lee como "sin barbería"', () => {
    localStorage.setItem(CLAVE, '{no es json');
    expect(ultimaBarberia.leer()).toBeNull();
  });

  it('si escribir falla, no lanza', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cuota llena');
    });
    expect(() => ultimaBarberia.guardar({ slug: SLUG, nombre: 'Barbería Huamanga' })).not.toThrow();
  });
});
