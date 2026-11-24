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
import { ultimaBarberia } from '../../src/ultima-barberia';
import { servidor } from '../setup';

// T074 de 010 · Pantalla /restablecer#<token> (contracts/pantallas.md; FR-021 a FR-023; research R09): quita el token de
// la dirección; reglas de la contraseña con el indicador de fortaleza; éxito → ingreso con el aviso del cambio (el de la
// última barbería si se conoce); 410 → mensaje neutro y enlace a /recuperar; 422 → pide una contraseña más segura.

const TOKEN = 'tOkEn_de-prueba_0123456789abcdefghijklmnopq';
const NUEVA = 'una frase nueva y larga';

function Direccion() {
  const { pathname, search, hash } = useLocation();
  return <span data-testid="direccion">{pathname + search + hash}</span>;
}

function renderizar(ruta = `/restablecer#${TOKEN}`) {
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

function servidorDeRestablecer(respuesta: () => Response = () => new HttpResponse(null, { status: 204 })) {
  const cuerpos: unknown[] = [];
  servidor.use(
    http.post('/api/v1/cuenta/recuperacion/contrasena', async ({ request }) => {
      cuerpos.push(await request.json());
      return respuesta();
    }),
  );
  return cuerpos;
}

const error = (estado: number, codigo: string, detalles: object[] = []) =>
  HttpResponse.json({ codigo, mensaje: 'Error de prueba.', detalles }, { status: estado });

async function elegir(contrasena = NUEVA, confirmacion = contrasena) {
  const usuario = userEvent.setup();
  await usuario.type(await screen.findByLabelText('Contraseña nueva'), contrasena);
  await usuario.type(screen.getByLabelText('Repite la contraseña'), confirmacion);
  await usuario.click(screen.getByRole('button', { name: 'Guardar mi contraseña nueva' }));
}

const direccion = () => screen.getByTestId('direccion').textContent;

afterEach(() => {
  tokenEnMemoria.limpiar();
  ultimaBarberia.olvidar();
});

describe('Elegir la contraseña nueva (/restablecer)', () => {
  it('quita el token de la dirección y no envía nada al abrir', async () => {
    const cuerpos = servidorDeRestablecer();
    renderizar();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Elige tu contraseña nueva' }),
    ).toBeInTheDocument();
    await waitFor(() => expect(direccion()).toBe('/restablecer'));
    expect(cuerpos).toEqual([]);
  });

  it('valida en la pantalla (largo y confirmación) sin llamar al servidor, con el indicador de fortaleza', async () => {
    const cuerpos = servidorDeRestablecer();
    renderizar();
    await elegir('corta', 'corta');
    expect(await screen.findByText('La contraseña debe tener al menos 10 caracteres.')).toBeInTheDocument();
    expect(screen.getByText(/Muy débil/)).toBeInTheDocument();
    expect(cuerpos).toEqual([]);
  });

  it('con éxito: envía el token y la contraseña y lleva al ingreso de la última barbería con el aviso', async () => {
    ultimaBarberia.guardar({ slug: 'barberia-huamanga', nombre: 'Barbería Huamanga' });
    const cuerpos = servidorDeRestablecer();
    renderizar();
    await elegir();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tu contraseña cambió; ingresa con la nueva.',
    );
    expect(direccion()).toBe('/b/barberia-huamanga/ingresar');
    expect(cuerpos).toEqual([{ token: TOKEN, contrasena: NUEVA }]);
  });

  it('con éxito y sin barbería conocida: lleva a /ingresar con el aviso', async () => {
    servidorDeRestablecer();
    renderizar();
    await elegir();
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Tu contraseña cambió; ingresa con la nueva.',
    );
    expect(direccion()).toBe('/ingresar');
  });

  it('410: mensaje neutro y enlace para pedir otro', async () => {
    servidorDeRestablecer(() => error(410, 'ENLACE_NO_VALIDO'));
    renderizar();
    await elegir();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este enlace ya no es válido' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Pedir un enlace nuevo' })).toHaveAttribute('href', '/recuperar');
  });

  it('sin token en la dirección: el mismo mensaje neutro', async () => {
    renderizar('/restablecer');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Este enlace ya no es válido' }),
    ).toBeInTheDocument();
  });

  it('422: pide una contraseña más segura y deja intentar de nuevo', async () => {
    servidorDeRestablecer(() =>
      error(422, 'VALIDACION', [{ campo: 'contrasena', problema: 'contiene_correo' }]),
    );
    renderizar();
    await elegir();
    expect(await screen.findByRole('alert')).toHaveTextContent('Elige una contraseña más segura');
    expect(screen.getByRole('button', { name: 'Guardar mi contraseña nueva' })).toBeEnabled();
  });
});
