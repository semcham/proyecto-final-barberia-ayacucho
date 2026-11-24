import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T054 de 010 · Pantalla /verificar#<token> (contracts/pantallas.md; research R09; FR-004 y FR-005): lee el token del
// fragmento y lo quita de la dirección; no envía nada hasta pulsar "Verificar mi correo"; con éxito lleva a /b/<slug>
// de la barbería de origen; un 410 muestra un mensaje neutro; un 429, el tiempo de espera.

const TOKEN = 'tOkEn_de-prueba_0123456789abcdefghijklmnopq';

function Direccion() {
  const { pathname, search, hash } = useLocation();
  return <output data-testid="direccion">{pathname + search + hash}</output>;
}

function renderizar(ruta = `/verificar#${TOKEN}`) {
  indicadorSesion.quitar();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
          <Direccion />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Registra lo que llega a POST /cuenta/verificacion y responde con `respuesta`. */
function servidorDeVerificacion(respuesta: () => Response) {
  const cuerpos: unknown[] = [];
  servidor.use(
    http.post('/api/v1/cuenta/verificacion', async ({ request }) => {
      cuerpos.push(await request.json());
      return respuesta();
    }),
  );
  return cuerpos;
}

const error = (estado: number, codigo: string, mensaje: string, encabezados: Record<string, string> = {}) =>
  HttpResponse.json({ codigo, mensaje, detalles: [] }, { status: estado, headers: encabezados });

afterEach(() => tokenEnMemoria.limpiar());

describe('Verificar el correo (/verificar)', () => {
  it('quita el token de la dirección y no envía nada hasta pulsar el botón (abrir no gasta el enlace)', async () => {
    const cuerpos = servidorDeVerificacion(() => HttpResponse.json({ barberia: 'barberia-huamanga' }));
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Verifica tu correo' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('direccion').textContent).toBe('/verificar'));
    expect(cuerpos).toEqual([]);

    await userEvent.setup().click(screen.getByRole('button', { name: 'Verificar mi correo' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Tu correo está verificado' }),
    ).toBeInTheDocument();
    expect(cuerpos).toEqual([{ token: TOKEN }]);
  });

  it('con éxito lleva a la barbería de origen (/b/<slug>)', async () => {
    servidorDeVerificacion(() => HttpResponse.json({ barberia: 'barberia-huamanga' }));
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: 'Verificar mi correo' }));
    const ir = await screen.findByRole('link', { name: 'Ir a la barbería' });
    expect(ir).toHaveAttribute('href', '/b/barberia-huamanga');
  });

  it('410: mensaje neutro y cómo pedir otro enlace', async () => {
    servidorDeVerificacion(() =>
      error(410, 'ENLACE_NO_VALIDO', 'Este enlace ya no es válido. Pide uno nuevo.'),
    );
    renderizar();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Verificar mi correo' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este enlace ya no es válido' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Reenviar correo de verificación/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/mis-citas');
  });

  it('sin token en la dirección: el mismo mensaje neutro, sin llamar al servidor', async () => {
    const cuerpos = servidorDeVerificacion(() => HttpResponse.json({ barberia: 'x' }));
    renderizar('/verificar');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este enlace ya no es válido' }),
    ).toBeInTheDocument();
    expect(cuerpos).toEqual([]);
  });

  it('429: "Demasiados intentos. Vuelve a intentar en N minutos." y el botón sigue disponible', async () => {
    servidorDeVerificacion(() =>
      error(429, 'DEMASIADOS_INTENTOS', 'Demasiados intentos.', { 'Retry-After': '300' }),
    );
    renderizar();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Verificar mi correo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demasiados intentos. Vuelve a intentar en 5 minutos.',
    );
    expect(screen.getByRole('button', { name: 'Verificar mi correo' })).toBeEnabled();
  });
});
