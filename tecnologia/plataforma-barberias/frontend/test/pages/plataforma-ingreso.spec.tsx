import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { tokenPlataforma } from '../../src/api/plataforma';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T066 · Ingreso del administrador de la plataforma (R07): los dos pasos, el código incorrecto, el código de
// recuperación, la salida, y que el token de plataforma vive separado de la sesión de barbería.

const DESAFIO = '0190a1b2-c3d4-7e5f-8a9b-00000000d001';
const TOKEN = 'token-de-plataforma';
const INCORRECTO = 'Los datos de ingreso no son correctos o el código ya no es válido.';

const noAutenticado = () =>
  HttpResponse.json({ codigo: 'NO_AUTENTICADO', mensaje: INCORRECTO, detalles: [] }, { status: 401 });

interface Registro {
  ingresos: unknown[];
  segundos: Record<string, unknown>[];
  salidas: (string | null)[];
}

function servidorPlataforma(opciones: { codigoValido?: string; recuperacionValida?: string } = {}): Registro {
  const registro: Registro = { ingresos: [], segundos: [], salidas: [] };
  servidor.use(
    // Sin cookie de plataforma: no hay sesión que renovar.
    http.post('/api/v1/plataforma/auth/renovar', () => noAutenticado()),
    http.post('/api/v1/plataforma/auth/ingresar', async ({ request }) => {
      const cuerpo = (await request.json()) as { correo: string; contrasena: string };
      registro.ingresos.push(cuerpo);
      if (cuerpo.contrasena !== 'clave-correcta-del-admin') return noAutenticado();
      return HttpResponse.json({ desafio: DESAFIO, expiraEn: '2026-10-28T15:05:00.000Z' });
    }),
    http.post('/api/v1/plataforma/auth/segundo-factor', async ({ request }) => {
      const cuerpo = (await request.json()) as Record<string, string>;
      registro.segundos.push(cuerpo);
      const valido =
        cuerpo.desafio === DESAFIO &&
        ((cuerpo.codigo !== undefined && cuerpo.codigo === (opciones.codigoValido ?? '123456')) ||
          (cuerpo.codigoRecuperacion !== undefined &&
            cuerpo.codigoRecuperacion === opciones.recuperacionValida));
      if (!valido) return noAutenticado();
      return HttpResponse.json(
        { tokenAcceso: TOKEN, tipo: 'Bearer', expiraEn: '2026-10-28T15:10:00.000Z' },
        {
          headers: {
            'Set-Cookie': 'rtp=renovacion; Path=/api/v1/plataforma/auth; HttpOnly; SameSite=Strict',
          },
        },
      );
    }),
    http.post('/api/v1/plataforma/auth/salir', ({ request }) => {
      registro.salidas.push(request.headers.get('Authorization'));
      return new HttpResponse(null, { status: 204 });
    }),
  );
  return registro;
}

function renderizar(ruta = '/plataforma/ingresar') {
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

async function primerPaso() {
  const usuario = userEvent.setup();
  const formulario = await screen.findByRole('form', { name: 'Correo y contraseña' });
  await usuario.type(within(formulario).getByLabelText('Correo'), 'admin@plataforma.local');
  await usuario.type(within(formulario).getByLabelText('Contraseña'), 'clave-correcta-del-admin');
  await usuario.click(within(formulario).getByRole('button', { name: 'Continuar' }));
  return usuario;
}

beforeEach(() => tokenPlataforma.limpiar());
afterEach(() => {
  tokenPlataforma.limpiar();
  tokenEnMemoria.limpiar();
});

describe('Ingreso del administrador (/plataforma/ingresar)', () => {
  it('sin sesión, /plataforma lleva al ingreso', async () => {
    servidorPlataforma();
    renderizar('/plataforma');
    expect(await screen.findByRole('heading', { name: 'Ingreso del administrador' })).toBeInTheDocument();
  });

  it('dos pasos: contraseña y código; entra al panel con el token de plataforma, separado del de barbería', async () => {
    const registro = servidorPlataforma();
    renderizar();
    const usuario = await primerPaso();

    const paso = await screen.findByRole('form', { name: 'Código de verificación' });
    expect(registro.ingresos).toEqual([
      { correo: 'admin@plataforma.local', contrasena: 'clave-correcta-del-admin' },
    ]);
    await usuario.type(within(paso).getByLabelText('Código de 6 dígitos'), '123456');
    await usuario.click(within(paso).getByRole('button', { name: 'Ingresar' }));

    expect(await screen.findByRole('heading', { name: 'Panel de la plataforma' })).toBeInTheDocument();
    expect(registro.segundos).toEqual([{ desafio: DESAFIO, codigo: '123456' }]);
    expect(tokenPlataforma.obtener()).toBe(TOKEN);
    // La sesión de barbería no recibió nada, y nada quedó guardado en el navegador.
    expect(tokenEnMemoria.obtener()).toBeNull();
    const guardado = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(guardado).not.toContain(TOKEN);
  });

  it('valida el formato del código sin llamar al servidor, y un código incorrecto muestra el mensaje y lo borra', async () => {
    const registro = servidorPlataforma();
    renderizar();
    const usuario = await primerPaso();
    const paso = await screen.findByRole('form', { name: 'Código de verificación' });
    const campo = within(paso).getByLabelText('Código de 6 dígitos');

    await usuario.type(campo, '12ab');
    await usuario.click(within(paso).getByRole('button', { name: 'Ingresar' }));
    expect(await within(paso).findByText('El código tiene 6 dígitos.')).toBeInTheDocument();
    expect(registro.segundos).toHaveLength(0);

    await usuario.clear(campo);
    await usuario.type(campo, '654321');
    await usuario.click(within(paso).getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText(INCORRECTO)).toBeInTheDocument();
    expect(campo).toHaveValue('');
    expect(screen.queryByRole('heading', { name: 'Panel de la plataforma' })).not.toBeInTheDocument();
    expect(tokenPlataforma.obtener()).toBeNull();
  });

  it('con un código de recuperación envía solo ese código y entra', async () => {
    const registro = servidorPlataforma({ recuperacionValida: 'ABCD-EFGH-JKMN' });
    renderizar();
    const usuario = await primerPaso();
    await screen.findByRole('form', { name: 'Código de verificación' });
    await usuario.click(screen.getByRole('button', { name: 'Usar un código de recuperación' }));
    const paso = screen.getByRole('form', { name: 'Código de recuperación' });
    await usuario.type(within(paso).getByLabelText('Código de recuperación'), 'ABCD-EFGH-JKMN');
    await usuario.click(within(paso).getByRole('button', { name: 'Ingresar con el código de recuperación' }));

    expect(await screen.findByRole('heading', { name: 'Panel de la plataforma' })).toBeInTheDocument();
    expect(registro.segundos).toEqual([{ desafio: DESAFIO, codigoRecuperacion: 'ABCD-EFGH-JKMN' }]);
  });

  it('una contraseña incorrecta muestra el mismo mensaje y no pasa al segundo paso', async () => {
    servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const formulario = await screen.findByRole('form', { name: 'Correo y contraseña' });
    await usuario.type(within(formulario).getByLabelText('Correo'), 'admin@plataforma.local');
    await usuario.type(within(formulario).getByLabelText('Contraseña'), 'otra');
    await usuario.click(within(formulario).getByRole('button', { name: 'Continuar' }));
    expect(await screen.findByText(INCORRECTO)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Código de verificación' })).not.toBeInTheDocument();
  });

  it('429 muestra cuántos minutos esperar', async () => {
    servidorPlataforma();
    servidor.use(
      http.post('/api/v1/plataforma/auth/ingresar', () =>
        HttpResponse.json(
          {
            codigo: 'DEMASIADOS_INTENTOS',
            mensaje: 'Demasiados intentos.',
            detalles: [{ reintentarEnSegundos: 600 }],
          },
          { status: 429, headers: { 'Retry-After': '600' } },
        ),
      ),
    );
    renderizar();
    await primerPaso();
    expect(
      await screen.findByText('Demasiados intentos. Vuelve a intentar en 10 minutos.'),
    ).toBeInTheDocument();
  });

  it('salir cierra la sesión con el token de plataforma y vuelve al ingreso', async () => {
    const registro = servidorPlataforma();
    renderizar();
    const usuario = await primerPaso();
    const paso = await screen.findByRole('form', { name: 'Código de verificación' });
    await usuario.type(within(paso).getByLabelText('Código de 6 dígitos'), '123456');
    await usuario.click(within(paso).getByRole('button', { name: 'Ingresar' }));
    await screen.findByRole('heading', { name: 'Panel de la plataforma' });

    await usuario.click(screen.getByRole('button', { name: 'Salir' }));
    expect(await screen.findByRole('heading', { name: 'Ingreso del administrador' })).toBeInTheDocument();
    expect(registro.salidas).toEqual([`Bearer ${TOKEN}`]);
    expect(tokenPlataforma.obtener()).toBeNull();
  });

  it('con la cookie de plataforma vigente, /plataforma renueva y entra sin pedir el código', async () => {
    servidorPlataforma();
    servidor.use(
      http.post('/api/v1/plataforma/auth/renovar', () =>
        HttpResponse.json({
          tokenAcceso: 'token-renovado',
          tipo: 'Bearer',
          expiraEn: '2026-10-28T15:10:00.000Z',
        }),
      ),
    );
    renderizar('/plataforma');
    expect(await screen.findByRole('heading', { name: 'Panel de la plataforma' })).toBeInTheDocument();
    expect(tokenPlataforma.obtener()).toBe('token-renovado');
    expect(tokenEnMemoria.obtener()).toBeNull();
  });
});
