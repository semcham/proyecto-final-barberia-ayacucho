import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T102 · Página pública de activación de cuenta (FR-022).

function renderizar(ruta: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function completar(contrasena: string, confirmacion = contrasena) {
  const persona = userEvent.setup();
  await persona.type(await screen.findByLabelText(/^contraseña$/i), contrasena);
  await persona.type(screen.getByLabelText(/repite la contraseña/i), confirmacion);
  await persona.click(screen.getByRole('button', { name: /activar mi cuenta/i }));
}

describe('Página de activación', () => {
  it('sin token en la URL muestra que el enlace no es válido', async () => {
    renderizar('/activar');
    expect(await screen.findByRole('alert')).toHaveTextContent(/el enlace no es válido/i);
    expect(screen.queryByRole('button', { name: /activar/i })).not.toBeInTheDocument();
  });

  it('valida que las contraseñas coincidan antes de llamar a la API', async () => {
    renderizar('/activar?token=abc123abc123abc123abc123');
    await completar('una clave larga y propia', 'otra clave distinta');
    expect(await screen.findByText(/las contraseñas no coinciden/i)).toBeInTheDocument();
  });

  it('con un enlace inválido muestra el mensaje del servidor', async () => {
    servidor.use(
      http.post('/api/v1/auth/activar', () =>
        HttpResponse.json(
          {
            codigo: 'ENLACE_INVALIDO',
            mensaje: 'El enlace no es válido o ya venció. Pide uno nuevo al propietario.',
            detalles: [],
          },
          { status: 400 },
        ),
      ),
    );
    renderizar('/activar?token=abc123abc123abc123abc123');
    await completar('una clave larga y propia');
    expect(await screen.findByRole('alert')).toHaveTextContent('Pide uno nuevo al propietario');
  });

  it('al activar envía el token y la contraseña y lleva a ingresar con un aviso', async () => {
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/auth/activar', async ({ request }) => {
        cuerpo = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderizar('/activar?token=abc123abc123abc123abc123');
    await completar('una clave larga y propia');
    expect(await screen.findByRole('heading', { name: /ingresa a tu barbería/i })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/tu cuenta está activa/i);
    expect(cuerpo).toEqual({ token: 'abc123abc123abc123abc123', contrasena: 'una clave larga y propia' });
  });
});
