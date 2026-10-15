import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import Registro from '../../src/pages/Registro';
import { servidor } from '../setup';

// T059 · Página de registro de la barbería (HU02).

const RESPUESTA_201 = {
  barberia: {
    id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
    nombre: 'Barbería Huamanga',
    slug: 'barberia-huamanga',
  },
  suscripcion: {
    estado: 'TRIAL',
    plan: 'TRIAL',
    iniciaEn: '2026-10-15T15:00:00Z',
    venceEn: '2026-10-29T15:00:00Z',
  },
  sesion: {
    tokenAcceso: 'token-nuevo',
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
  },
};

function RutaActual() {
  return <output data-testid="ruta">{useLocation().pathname}</output>;
}

// MemoryRouter (no el router de datos): el router de datos crea objetos Request con el AbortSignal de
// jsdom, que el fetch de Node rechaza.
function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
      <MemoryRouter initialEntries={['/registro']}>
        <SesionProvider>
          <Routes>
            <Route path="/registro" element={<Registro />} />
            <Route path="/app" element={<h1>Panel de la barbería</h1>} />
          </Routes>
          <RutaActual />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rutaActual = () => screen.getByTestId('ruta').textContent;

async function completarFormulario() {
  const usuario = userEvent.setup();
  await usuario.type(screen.getByLabelText(/nombre de la barbería/i), 'Barbería Huamanga');
  await usuario.type(screen.getByLabelText(/tu nombre/i), 'Rosa Quispe');
  await usuario.type(screen.getByLabelText(/correo/i), 'rosa@prueba.pe');
  await usuario.type(screen.getByLabelText(/contraseña/i), 'mi barberia en huamanga');
  await usuario.click(screen.getByLabelText(/términos de uso/i));
  await usuario.click(screen.getByLabelText(/política de tratamiento de datos/i));
  return usuario;
}

describe('Página de registro', () => {
  afterEach(() => tokenEnMemoria.limpiar());

  it('muestra los errores de validación sin llamar a la API', async () => {
    renderizar();
    await userEvent.setup().click(screen.getByRole('button', { name: /crear mi barbería/i }));
    expect(await screen.findByText(/ingresa el nombre de tu barbería/i)).toBeInTheDocument();
    expect(screen.getByText(/ingresa un correo válido/i)).toBeInTheDocument();
    expect(screen.getByText(/la contraseña debe tener al menos 10 caracteres/i)).toBeInTheDocument();
    expect(screen.getAllByText(/debes aceptar/i)).toHaveLength(2);
  });

  it('no pide ningún dato de pago ni de tarjeta (FR-004)', () => {
    renderizar();
    expect(screen.queryByLabelText(/tarjeta|pago|cvv|vencimiento/i)).not.toBeInTheDocument();
    expect(document.querySelectorAll('input[autocomplete^="cc-"]')).toHaveLength(0);
    expect(screen.getByText(/sin tarjeta/i)).toBeInTheDocument();
  });

  it('con datos válidos registra, guarda el token en memoria y entra al panel', async () => {
    let cuerpoEnviado: unknown;
    servidor.use(
      http.post('/api/v1/barberias', async ({ request }) => {
        cuerpoEnviado = await request.json();
        return HttpResponse.json(RESPUESTA_201, { status: 201 });
      }),
    );
    renderizar();
    const usuario = await completarFormulario();
    await usuario.click(screen.getByRole('button', { name: /crear mi barbería/i }));

    expect(await screen.findByRole('heading', { name: /panel de la barbería/i })).toBeInTheDocument();
    expect(rutaActual()).toBe('/app');
    expect(tokenEnMemoria.obtener()).toBe('token-nuevo');
    expect(cuerpoEnviado).toEqual({
      nombreBarberia: 'Barbería Huamanga',
      propietario: { nombre: 'Rosa Quispe', correo: 'rosa@prueba.pe', contrasena: 'mi barberia en huamanga' },
      aceptaciones: { terminosVersion: expect.any(String), politicaDatosVersion: expect.any(String) },
    });
  });

  it('ante un 409 muestra el mensaje genérico del servidor y no navega', async () => {
    servidor.use(
      http.post('/api/v1/barberias', () =>
        HttpResponse.json(
          {
            codigo: 'CORREO_NO_DISPONIBLE',
            mensaje: 'Ese correo no está disponible. Usa otro correo.',
            detalles: [],
          },
          { status: 409 },
        ),
      ),
    );
    renderizar();
    const usuario = await completarFormulario();
    await usuario.click(screen.getByRole('button', { name: /crear mi barbería/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ese correo no está disponible. Usa otro correo.',
    );
    expect(rutaActual()).toBe('/registro');
    expect(tokenEnMemoria.obtener()).toBeNull();
  });
});
