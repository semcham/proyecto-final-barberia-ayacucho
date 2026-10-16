import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { type ReactNode, useState } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { llamarApi, tokenEnMemoria } from '../../src/api/client';
import { RutaProtegida } from '../../src/auth/RutaProtegida';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T077 · Sesión en la interfaz: token solo en memoria, recuperación con la cookie, renovación ante 401,
// cierre de sesión y espera ante 429.

const sesion = (token: string) => ({
  tokenAcceso: token,
  tipo: 'Bearer',
  expiraEn: 900,
  usuario: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c',
    nombre: 'Rosa Quispe',
    correo: 'rosa@prueba.pe',
    rol: 'PROPIETARIO',
    barberia: {
      id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
      nombre: 'Barbería Huamanga',
      slug: 'barberia-huamanga',
    },
  },
});

const noAutenticado = () =>
  HttpResponse.json(
    { codigo: 'NO_AUTENTICADO', mensaje: 'Inicia sesión para continuar.', detalles: [] },
    { status: 401 },
  );

function RutaActual() {
  return <output data-testid="ruta">{useLocation().pathname}</output>;
}

function renderizar(ruta: string, contenido: ReactNode = <RutasApp />) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          {contenido}
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rutaActual = () => screen.getByTestId('ruta').textContent;

async function ingresar(correo = 'rosa@prueba.pe', contrasena = 'mi barberia en huamanga') {
  const usuario = userEvent.setup();
  await usuario.type(await screen.findByLabelText(/correo/i), correo);
  await usuario.type(screen.getByLabelText(/contraseña/i), contrasena);
  await usuario.click(screen.getByRole('button', { name: /^ingresar$/i }));
  return usuario;
}

describe('Sesión en la interfaz', () => {
  afterEach(() => {
    tokenEnMemoria.limpiar();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('al iniciar sesión guarda el token solo en memoria y entra al panel', async () => {
    servidor.use(http.post('/api/v1/auth/login', () => HttpResponse.json(sesion('token-de-acceso'))));
    renderizar('/ingresar');
    await ingresar();

    expect(await screen.findByRole('heading', { name: 'Barbería Huamanga' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/app');
    expect(tokenEnMemoria.obtener()).toBe('token-de-acceso');
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('token-de-acceso');
  });

  it('al recargar recupera la sesión con /auth/refresh sin pedir la contraseña', async () => {
    servidor.use(http.post('/api/v1/auth/refresh', () => HttpResponse.json(sesion('token-renovado'))));
    renderizar('/app');
    expect(await screen.findByRole('heading', { name: 'Barbería Huamanga' })).toBeInTheDocument();
    expect(rutaActual()).toBe('/app');
    expect(tokenEnMemoria.obtener()).toBe('token-renovado');
  });

  it('sin sesión, /app lleva a /ingresar', async () => {
    renderizar('/app');
    expect(await screen.findByRole('heading', { name: /ingresa a tu barbería/i })).toBeInTheDocument();
    expect(rutaActual()).toBe('/ingresar');
  });

  it('un 401 dispara una sola renovación; si falla, la sesión se pierde y vuelve a /ingresar', async () => {
    let renovaciones = 0;
    servidor.use(
      http.post('/api/v1/auth/refresh', () => {
        renovaciones += 1;
        // La primera (al cargar) funciona; la que provoca el 401 ya no.
        return renovaciones === 1 ? HttpResponse.json(sesion('token-1')) : noAutenticado();
      }),
      http.get('/api/v1/auth/yo', noAutenticado),
    );

    function PantallaQueLlamaALaApi() {
      const [estado, setEstado] = useState('sin llamar');
      return (
        <button type="button" onClick={() => llamarApi('/auth/yo').catch(() => setEstado('falló'))}>
          Consultar ({estado})
        </button>
      );
    }

    renderizar(
      '/app',
      <Routes>
        <Route path="/ingresar" element={<h1>Ingresa a tu barbería</h1>} />
        <Route
          path="/app"
          element={
            <RutaProtegida>
              <PantallaQueLlamaALaApi />
            </RutaProtegida>
          }
        />
      </Routes>,
    );

    await userEvent.setup().click(await screen.findByRole('button', { name: /consultar/i }));
    expect(await screen.findByRole('heading', { name: /ingresa a tu barbería/i })).toBeInTheDocument();
    expect(renovaciones).toBe(2);
    expect(tokenEnMemoria.obtener()).toBeNull();
  });

  it('cerrar sesión limpia el estado y lleva a /ingresar', async () => {
    let cerro = false;
    servidor.use(
      http.post('/api/v1/auth/refresh', () => HttpResponse.json(sesion('token-1'))),
      http.post('/api/v1/auth/logout', () => {
        cerro = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderizar('/app');
    // Cerrar sesión está en el menú de usuario de la cabecera.
    const persona = userEvent.setup();
    await persona.click(await screen.findByRole('button', { name: /rosa quispe/i }));
    await persona.click(await screen.findByRole('menuitem', { name: /cerrar sesión/i }));

    expect(await screen.findByRole('heading', { name: /ingresa a tu barbería/i })).toBeInTheDocument();
    expect(rutaActual()).toBe('/ingresar');
    expect(cerro).toBe(true);
    expect(tokenEnMemoria.obtener()).toBeNull();
  });

  it('ante un 429 muestra el tiempo de espera', async () => {
    servidor.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos.', detalles: [] },
          { status: 429, headers: { 'Retry-After': '60' } },
        ),
      ),
    );
    renderizar('/ingresar');
    await ingresar();
    expect(await screen.findByRole('alert')).toHaveTextContent('Vuelve a intentar en 60 segundos');
    expect(rutaActual()).toBe('/ingresar');
  });

  it('ante credenciales inválidas muestra el mensaje genérico del servidor', async () => {
    servidor.use(
      http.post('/api/v1/auth/login', () =>
        HttpResponse.json(
          { codigo: 'CREDENCIALES_INVALIDAS', mensaje: 'Correo o contraseña incorrectos.', detalles: [] },
          { status: 401 },
        ),
      ),
    );
    renderizar('/ingresar');
    await ingresar('rosa@prueba.pe', 'equivocada');
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
  });
});
