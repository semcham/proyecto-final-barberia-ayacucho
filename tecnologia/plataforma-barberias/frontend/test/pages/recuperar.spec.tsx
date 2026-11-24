import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T074 de 010 · Pantalla /recuperar (contracts/pantallas.md; FR-018 a FR-020): pide solo el correo; envía `barberia` si
// se llega desde el ingreso de una barbería; tras enviar, siempre el mismo mensaje; un 429 muestra el tiempo de espera.

const NEUTRA = { mensaje: 'Si hay una cuenta con ese correo, te enviamos un enlace.' };

function renderizar(entrada: string | { pathname: string; state: unknown } = '/recuperar') {
  indicadorSesion.quitar();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[entrada]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function servidorDeRecuperacion(
  respuesta: () => Response = () => HttpResponse.json(NEUTRA, { status: 202 }),
) {
  const cuerpos: unknown[] = [];
  servidor.use(
    http.post('/api/v1/cuenta/recuperacion', async ({ request }) => {
      cuerpos.push(await request.json());
      return respuesta();
    }),
  );
  return cuerpos;
}

async function enviar(correo: string) {
  const usuario = userEvent.setup();
  await usuario.type(await screen.findByLabelText('Correo'), correo);
  await usuario.click(screen.getByRole('button', { name: 'Enviarme el enlace' }));
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Recuperar la contraseña (/recuperar)', () => {
  it('pide solo el correo y, tras enviar, muestra el mensaje neutro', async () => {
    const cuerpos = servidorDeRecuperacion();
    renderizar();
    expect(
      await screen.findByRole('heading', { level: 1, name: '¿Olvidaste tu contraseña?' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('form', { name: 'Recuperar la contraseña' }).querySelectorAll('input'),
    ).toHaveLength(1);
    await enviar('rosa@prueba.pe');
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Si hay una cuenta con ese correo, te enviamos un enlace.',
    );
    expect(cuerpos).toEqual([{ correo: 'rosa@prueba.pe' }]);
    expect(screen.getByRole('link', { name: 'Volver a ingresar' })).toHaveAttribute('href', '/ingresar');
  });

  it('desde el ingreso de una barbería envía su enlace y vuelve a ese ingreso', async () => {
    const cuerpos = servidorDeRecuperacion();
    renderizar({ pathname: '/recuperar', state: { barberia: 'barberia-huamanga' } });
    await enviar('luis@prueba.pe');
    await screen.findByRole('status');
    expect(cuerpos).toEqual([{ correo: 'luis@prueba.pe', barberia: 'barberia-huamanga' }]);
    expect(screen.getByRole('link', { name: 'Volver a ingresar' })).toHaveAttribute(
      'href',
      '/b/barberia-huamanga/ingresar',
    );
  });

  it('un valor raro en el estado de la navegación no se envía', async () => {
    const cuerpos = servidorDeRecuperacion();
    renderizar({ pathname: '/recuperar', state: { barberia: '../../otra cosa' } });
    await enviar('luis@prueba.pe');
    await screen.findByRole('status');
    expect(cuerpos).toEqual([{ correo: 'luis@prueba.pe' }]);
  });

  it('sin correo no envía nada', async () => {
    const cuerpos = servidorDeRecuperacion();
    renderizar();
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Enviarme el enlace' }));
    expect(await screen.findByText('Escribe tu correo.')).toBeInTheDocument();
    expect(cuerpos).toEqual([]);
  });

  it('429: "Demasiados intentos. Vuelve a intentar en N minutos."', async () => {
    servidorDeRecuperacion(() =>
      HttpResponse.json(
        {
          codigo: 'DEMASIADOS_INTENTOS',
          mensaje: 'Demasiados intentos.',
          detalles: [{ reintentarEnSegundos: 120 }],
        },
        { status: 429, headers: { 'Retry-After': '120' } },
      ),
    );
    renderizar();
    await enviar('rosa@prueba.pe');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Demasiados intentos. Vuelve a intentar en 2 minutos.',
    );
  });
});
