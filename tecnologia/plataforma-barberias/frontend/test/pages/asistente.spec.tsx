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

// T038 de 005 · Asistente del cliente (/asistente; US1, FR-007, FR-008, FR-012, FR-013 y FR-018): la respuesta aparece
// en una región que se anuncia (aria-live); hay un contador de 500 caracteres y una pregunta vacía no se envía; la
// cuota agotada dice cuándo se reinicia y ofrece reservar; "no disponible" ofrece la alternativa manual; cada hora
// libre lleva a Reservar con todo elegido; la conversación vive solo en memoria (al recargar empieza de nuevo) y se
// envían como mucho las últimas 6 intervenciones; solo el cliente con sesión ve la pantalla.

const SLUG = 'huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };
const CUOTA = { restantesUsuario: 19, restantesBarberia: 199, reiniciaEn: '2026-11-15T00:00:00-05:00' };

function sesion(rol: 'CLIENTE' | 'PROPIETARIO') {
  return http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-0000-7000-8000-000000000009',
        nombre: 'Luis Huamán',
        correo: 'luis@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );
}

const SERVICIOS = {
  texto: 'Estos son los servicios de Barbería Huamanga: Corte clásico — S/ 25.00 (30 min).',
  resultado: 'RESPONDIDA',
  datos: {
    tipo: 'SERVICIOS',
    servicios: [
      { servicioId: 's1', nombre: 'Corte clásico', precio: '25.00', duracionMinutos: 30, descripcion: null },
    ],
  },
  cuota: CUOTA,
};

const HORARIOS = {
  texto: 'Para Corte clásico el domingo 15 de noviembre de 2026 hay horario a las 10:00. ¿Quieres reservar?',
  resultado: 'RESPONDIDA',
  datos: {
    tipo: 'HORARIOS',
    servicio: { servicioId: 's1', nombre: 'Corte clásico' },
    fecha: '2026-11-15',
    horas: [
      {
        inicio: '2026-11-15T10:00:00-05:00',
        barberos: [{ barberoId: 'b1', nombre: 'Luis' }],
        enlace: '/b/huamanga/reservar?servicio=s1&barbero=b1&inicio=2026-11-15T10%3A00%3A00-05%3A00',
      },
    ],
  },
  sugerencia: { tipo: 'RESERVAR', enlace: '/b/huamanga/reservar?servicio=s1' },
  cuota: CUOTA,
};

/** El servidor del asistente: responde con `responder` y guarda cada cuerpo recibido. */
function servidorDelAsistente(
  responder: (cuerpo: { mensaje: string }) => Response = () => HttpResponse.json(SERVICIOS),
) {
  const recibidos: { mensaje: string; contexto?: { de: string; texto: string }[] }[] = [];
  servidor.use(
    sesion('CLIENTE'),
    http.post('/api/v1/asistente/mensajes', async ({ request }) => {
      const cuerpo = (await request.json()) as { mensaje: string };
      recibidos.push(cuerpo);
      return responder(cuerpo);
    }),
  );
  return recibidos;
}

function renderizar(ruta = '/asistente') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function preguntarEnPantalla(texto: string) {
  const usuario = userEvent.setup();
  const campo = await screen.findByLabelText('Tu pregunta');
  await usuario.clear(campo);
  await usuario.type(campo, texto);
  await usuario.click(screen.getByRole('button', { name: 'Preguntar' }));
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Asistente del cliente (/asistente)', () => {
  it('envía la pregunta y muestra la respuesta en una región que se anuncia', async () => {
    const recibidos = servidorDelAsistente();
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Asistente' })).toBeInTheDocument();
    await preguntarEnPantalla('¿Qué servicios tienen?');
    const conversacion = screen.getByRole('log', { name: 'Conversación' });
    expect(conversacion).toHaveAttribute('aria-live', 'polite');
    expect(await within(conversacion).findByText(SERVICIOS.texto)).toBeInTheDocument();
    expect(within(conversacion).getByText('¿Qué servicios tienen?')).toBeInTheDocument();
    expect(recibidos).toEqual([{ mensaje: '¿Qué servicios tienen?', contexto: [] }]);
  });

  it('cuenta los caracteres hasta 500 y no deja escribir más', async () => {
    servidorDelAsistente();
    renderizar();
    const usuario = userEvent.setup();
    const campo = await screen.findByLabelText('Tu pregunta');
    expect(screen.getByText('0/500')).toBeInTheDocument();
    await usuario.type(campo, 'Hola');
    expect(screen.getByText('4/500')).toBeInTheDocument();
    expect(campo).toHaveAttribute('maxLength', '500');
  });

  it('una pregunta vacía (o solo espacios) no se envía', async () => {
    const recibidos = servidorDelAsistente();
    renderizar();
    const usuario = userEvent.setup();
    await usuario.type(await screen.findByLabelText('Tu pregunta'), '   ');
    await usuario.click(screen.getByRole('button', { name: 'Preguntar' }));
    expect(recibidos).toEqual([]);
    expect(screen.getByText('Escribe tu pregunta.')).toBeInTheDocument();
  });

  it('envía como contexto solo las últimas 6 intervenciones de la conversación', async () => {
    const recibidos = servidorDelAsistente();
    renderizar();
    for (const pregunta of ['uno', 'dos', 'tres', 'cuatro']) {
      await preguntarEnPantalla(pregunta);
      await screen.findAllByText(SERVICIOS.texto);
    }
    expect(recibidos[1].contexto).toEqual([
      { de: 'USUARIO', texto: 'uno' },
      { de: 'ASISTENTE', texto: SERVICIOS.texto },
    ]);
    expect(recibidos[3].contexto).toHaveLength(6);
    expect(recibidos[3].contexto?.[0]).toEqual({ de: 'USUARIO', texto: 'uno' });
    expect(recibidos[3].contexto?.at(-1)).toEqual({ de: 'ASISTENTE', texto: SERVICIOS.texto });
  });

  it('cada hora libre lleva a Reservar con el servicio, el barbero y la hora elegidos', async () => {
    servidorDelAsistente(() => HttpResponse.json(HORARIOS));
    renderizar();
    await preguntarEnPantalla('¿Hay horario mañana para un corte?');
    const enlace = await screen.findByRole('link', { name: /Reservar a las 10:00 con Luis/ });
    expect(enlace).toHaveAttribute('href', HORARIOS.datos.horas[0].enlace);
  });

  it('con la cuota agotada dice cuándo se reinicia y ofrece reservar', async () => {
    servidorDelAsistente(() =>
      HttpResponse.json(
        {
          codigo: 'CUOTA_ASISTENTE_AGOTADA',
          mensaje: 'Llegaste al límite de preguntas de hoy.',
          detalles: [
            { alcance: 'USUARIO', reiniciaEn: '2026-11-15T00:00:00-05:00', reintentarEnSegundos: 600 },
          ],
        },
        { status: 429, headers: { 'Retry-After': '600' } },
      ),
    );
    renderizar();
    await preguntarEnPantalla('precios');
    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent('Llegaste al límite de preguntas de hoy.');
    expect(aviso).toHaveTextContent('15 de noviembre de 2026, 00:00');
    expect(screen.getByRole('link', { name: 'Ir a reservar' })).toHaveAttribute('href', `/b/${SLUG}`);
  });

  it('"no disponible" muestra la alternativa manual', async () => {
    servidorDelAsistente(() =>
      HttpResponse.json(
        {
          codigo: 'ASISTENTE_NO_DISPONIBLE',
          mensaje: 'El asistente no está disponible ahora. Puedes reservar directamente.',
          detalles: [{ alternativa: { tipo: 'RESERVAR' } }],
        },
        { status: 503 },
      ),
    );
    renderizar();
    await preguntarEnPantalla('precios');
    expect(await screen.findByRole('alert')).toHaveTextContent('no está disponible');
    expect(screen.getByRole('link', { name: 'Ir a reservar' })).toHaveAttribute('href', `/b/${SLUG}`);
  });

  it('al recargar la página, la conversación empieza de nuevo (nada se guarda)', async () => {
    servidorDelAsistente();
    const { unmount } = renderizar();
    await preguntarEnPantalla('¿Qué servicios tienen?');
    await screen.findByText(SERVICIOS.texto);
    unmount();
    tokenEnMemoria.limpiar();
    renderizar();
    await screen.findByLabelText('Tu pregunta');
    expect(screen.queryByText(SERVICIOS.texto)).not.toBeInTheDocument();
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);
  });

  it('el propietario no ve el asistente del cliente', async () => {
    const recibidos: unknown[] = [];
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/barberia', () =>
        HttpResponse.json({
          ...BARBERIA,
          direccion: null,
          telefono: null,
          descripcion: null,
          zonaHoraria: 'America/Lima',
          antelacionCancelacionMinutos: 120,
        }),
      ),
      http.post('/api/v1/asistente/mensajes', () => {
        recibidos.push(1);
        return HttpResponse.json(SERVICIOS);
      }),
    );
    renderizar();
    await screen.findByRole('navigation', { name: 'Principal' });
    expect(screen.queryByRole('heading', { level: 1, name: 'Asistente' })).not.toBeInTheDocument();
    expect(recibidos).toEqual([]);
  });
});
