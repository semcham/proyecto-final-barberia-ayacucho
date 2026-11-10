import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { indicadorSesion } from '../../src/auth/indicadorSesion';
import { RutasApp } from '../../src/routes';
import { enlaces } from '../msw-handlers';
import { servidor } from '../setup';

// T086 · Página del enlace de acción /e (RF34; research R15; contracts/enlaces-de-accion.md). Sin sesión.
// - Lee el token del FRAGMENTO (#…), que el navegador no envía al servidor, y lo quita de la dirección al leerlo.
// - Lo manda solo en el encabezado X-Enlace-Accion; muestra los datos mínimos de la cita.
// - Confirma, cancela y reprograma (con SelectorDeHora y los horarios públicos de la barbería).
// - Enlace no válido → el mensaje genérico con la opción de iniciar sesión; 429 → cuándo reintentar.
// - Estados cargando y error; todo se puede hacer solo con el teclado.

const TOKEN = 'datosdelenlace_0123456789abcdef.firmadelenlace_ABCDEFGHIJ';
const SLUG = 'barberia-huamanga';
const SERVICIO = '0190a1b2-c3d4-7e5f-8a9b-000000000001';
const BARBERO = '0190a1b2-c3d4-7e5f-8a9b-000000000002';
const HORA_MS = 60 * 60 * 1000;
const enLima = (instante: Date) =>
  `${new Date(instante.getTime() - 5 * HORA_MS).toISOString().slice(0, 19)}-05:00`;
const INICIO = enLima(new Date(Date.now() + 5 * HORA_MS));
const FECHA = INICIO.slice(0, 10);

const datosDe = (accion: 'CONFIRMAR' | 'CANCELAR' | 'REPROGRAMAR', extra: Record<string, unknown> = {}) => ({
  accion,
  cita: {
    barberia: 'Barbería Huamanga',
    servicio: 'Corte clásico',
    barbero: 'Carlos Ñaupa',
    inicio: INICIO,
    fin: enLima(new Date(Date.parse(INICIO) + 30 * 60_000)),
    zonaHoraria: 'America/Lima',
    ...extra,
  },
  ...(accion === 'REPROGRAMAR' && {
    reprogramacion: { slug: SLUG, servicioId: SERVICIO, barberoId: BARBERO },
  }),
});

function Ubicacion() {
  const ubicacion = useLocation();
  // Un <div>, no <output>: <output> tiene el rol implícito "status", el mismo de los mensajes de éxito.
  return <div data-testid="ubicacion">{`${ubicacion.pathname}${ubicacion.hash}`}</div>;
}

function renderizar(ruta = `/e#${TOKEN}`) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[ruta]}>
        <SesionProvider>
          <RutasApp />
          <Ubicacion />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Página del enlace /e (T086)', () => {
  // Un visitante sin sesión: la página no intenta renovar ninguna.
  const sinSesion = () => indicadorSesion.quitar();

  it('lee el token del fragmento, lo quita de la dirección y lo manda solo en X-Enlace-Accion', async () => {
    sinSesion();
    const recibidos: string[] = [];
    servidor.use(enlaces.consulta(datosDe('CONFIRMAR'), recibidos));
    renderizar();
    expect(await screen.findByText('Corte clásico')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('ubicacion')).toHaveTextContent(/^\/e$/));
    expect(recibidos).toHaveLength(1);
    const [token, url] = recibidos[0].split('|');
    expect(token).toBe(TOKEN);
    expect(url).not.toContain(TOKEN);
    // Datos mínimos: barbería, servicio, barbero y hora; nada del cliente.
    for (const texto of ['Barbería Huamanga', 'Carlos Ñaupa'])
      expect(screen.getAllByText(new RegExp(texto)).length).toBeGreaterThan(0);
  });

  it('confirma la asistencia', async () => {
    sinSesion();
    const recibidos: unknown[] = [];
    servidor.use(
      enlaces.consulta(datosDe('CONFIRMAR')),
      enlaces.accion(
        'confirmar',
        {
          accion: 'CONFIRMAR',
          cita: { estado: 'CONFIRMADA', inicio: INICIO, confirmadaPorClienteEn: enLima(new Date()) },
        },
        recibidos,
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /confirmo mi asistencia/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/confirmaste tu asistencia/i);
    expect(recibidos).toEqual([{ token: TOKEN, cuerpo: {} }]);
    expect(screen.queryByRole('button', { name: /confirmo mi asistencia/i })).not.toBeInTheDocument();
  });

  it('cancela con confirmación previa y avisa si será tardía', async () => {
    sinSesion();
    const recibidos: unknown[] = [];
    servidor.use(
      enlaces.consulta(
        datosDe('CANCELAR', { cancelacionTardiaDesde: enLima(new Date(Date.now() - HORA_MS)) }),
      ),
      enlaces.accion(
        'cancelar',
        { accion: 'CANCELAR', cita: { estado: 'CANCELADA', inicio: INICIO, cancelacionTardia: true } },
        recibidos,
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /cancelar la cita/i }));
    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent(/cancelación tardía/i);
    await usuario.click(within(modal).getByRole('button', { name: /sí, cancelar la cita/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/tu cita fue cancelada/i);
    expect(recibidos).toHaveLength(1);
  });

  it('reprograma con la selección de hora y los horarios públicos de la barbería', async () => {
    sinSesion();
    const consultas: string[] = [];
    const recibidos: unknown[] = [];
    servidor.use(
      enlaces.consulta(datosDe('REPROGRAMAR')),
      http.get(`/api/v1/publico/${SLUG}/horarios`, ({ request }) => {
        const parametros = new URL(request.url).searchParams;
        consultas.push(parametros.toString());
        const fecha = parametros.get('fecha') as string;
        return HttpResponse.json({
          fecha,
          zonaHoraria: 'America/Lima',
          calculadoEn: new Date().toISOString(),
          servicioId: SERVICIO,
          horas: [
            { inicio: `${fecha}T10:00:00-05:00`, barberoIds: [BARBERO] },
            { inicio: `${fecha}T10:30:00-05:00`, barberoIds: ['otro'] },
          ],
        });
      }),
      enlaces.accion(
        'reprogramar',
        { accion: 'REPROGRAMAR', cita: { estado: 'CONFIRMADA', inicio: `${FECHA}T10:00:00-05:00` } },
        recibidos,
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const horas = await screen.findByRole('group', { name: /horas libres/i });
    // Solo las horas del barbero de la cita.
    expect(
      within(horas)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['10:00']);
    expect(consultas[0]).toContain(`servicio=${SERVICIO}`);
    await usuario.click(within(horas).getByRole('button', { name: '10:00' }));
    await usuario.click(screen.getByRole('button', { name: /reprogramar a las 10:00/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/tu cita quedó/i);
    expect(recibidos).toEqual([
      { token: TOKEN, cuerpo: { inicio: `${FECHA}T10:00:00-05:00`, barberoId: BARBERO } },
    ]);
  });

  it('reprogramar: 409 avisa que la hora ya no está libre y deja elegir otra', async () => {
    sinSesion();
    servidor.use(
      enlaces.consulta(datosDe('REPROGRAMAR')),
      http.get(`/api/v1/publico/${SLUG}/horarios`, ({ request }) => {
        const fecha = new URL(request.url).searchParams.get('fecha') as string;
        return HttpResponse.json({
          fecha,
          zonaHoraria: 'America/Lima',
          calculadoEn: new Date().toISOString(),
          servicioId: SERVICIO,
          horas: [{ inicio: `${fecha}T10:00:00-05:00`, barberoIds: [BARBERO] }],
        });
      }),
      http.post('/api/v1/enlaces/accion/reprogramar', () =>
        HttpResponse.json(
          {
            codigo: 'HORARIO_NO_DISPONIBLE',
            mensaje: 'Ese horario ya no está disponible. Elige otra hora.',
            detalles: [],
          },
          { status: 409 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: '10:00' }));
    await usuario.click(screen.getByRole('button', { name: /reprogramar a las 10:00/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/ya no está disponible/i);
  });

  it('un enlace no válido muestra el mensaje genérico con la opción de iniciar sesión', async () => {
    sinSesion();
    servidor.use(enlaces.noValido());
    renderizar();
    expect(await screen.findByRole('heading', { name: /este enlace ya no es válido/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /iniciar sesión/i })).toBeInTheDocument();
  });

  it('sin token en la dirección muestra el mismo mensaje genérico, sin llamar a la API', async () => {
    sinSesion();
    renderizar('/e');
    expect(await screen.findByRole('heading', { name: /este enlace ya no es válido/i })).toBeInTheDocument();
  });

  it('429 dice cuándo reintentar', async () => {
    sinSesion();
    servidor.use(enlaces.demasiados(45));
    renderizar();
    expect(await screen.findByRole('alert')).toHaveTextContent(/45 segundos/i);
  });

  it('muestra "cargando" mientras consulta y un error con reintento si falla la conexión', async () => {
    sinSesion();
    let intentos = 0;
    servidor.use(
      http.get('/api/v1/enlaces/accion', async () => {
        intentos += 1;
        await delay(200);
        if (intentos === 1) return HttpResponse.error();
        return HttpResponse.json(datosDe('CONFIRMAR'));
      }),
    );
    renderizar();
    expect(await screen.findByText(/cargando el enlace/i)).toBeInTheDocument();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('button', { name: /intentar de nuevo/i }));
    expect(await screen.findByRole('button', { name: /confirmo mi asistencia/i })).toBeInTheDocument();
  });

  it('se completa solo con el teclado', async () => {
    sinSesion();
    const recibidos: unknown[] = [];
    servidor.use(
      enlaces.consulta(datosDe('CONFIRMAR')),
      enlaces.accion(
        'confirmar',
        { accion: 'CONFIRMAR', cita: { estado: 'CONFIRMADA', inicio: INICIO, confirmadaPorClienteEn: null } },
        recibidos,
      ),
    );
    renderizar();
    await screen.findByRole('button', { name: /confirmo mi asistencia/i });
    const usuario = userEvent.setup();
    for (let i = 0; i < 20; i += 1) {
      await usuario.tab();
      if (/confirmo mi asistencia/i.test(document.activeElement?.textContent ?? '')) break;
    }
    expect(document.activeElement).toHaveTextContent(/confirmo mi asistencia/i);
    await usuario.keyboard('{Enter}');
    expect(await screen.findByRole('status')).toHaveTextContent(/confirmaste tu asistencia/i);
    expect(recibidos).toHaveLength(1);
  });
});
