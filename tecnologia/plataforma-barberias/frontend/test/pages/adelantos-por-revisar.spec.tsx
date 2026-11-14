import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { fechaIsoDeBarberia } from '../../src/hora-barberia';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T040 de 008 · Bandeja de pagos por revisar del propietario (/app/adelantos; US3, FR-012 a FR-014): solo el
// propietario; cada pago con el cliente, el servicio, el monto, el código, el número, la hora límite y el límite
// máximo; la captura (URL local que se revoca); confirmar con un diálogo accesible; rechazar exigiendo el motivo;
// estados cargando, vacío y error; todo con el teclado. Además, la Agenda muestra el estado del adelanto (T045).

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};
const CITA_A = '0190a1b2-0000-7000-8000-0000000000a1';
const CITA_B = '0190a1b2-0000-7000-8000-0000000000a2';

const enBandeja = (citaId: string, cliente: string, cambios: object = {}) => ({
  citaId,
  cliente,
  servicio: 'Corte',
  barbero: 'Luis',
  inicio: '2026-12-20T11:00:00-05:00',
  adelanto: {
    citaId,
    estado: 'POR_REVISAR',
    montoCentimos: 400,
    precioCentimos: 2000,
    saldoCentimos: 1600,
    codigo: citaId === CITA_A ? 'K7Q2MP' : 'H4ZT9W',
    horaLimite: '2026-12-19T10:30:00-05:00',
    limiteRevision: '2026-12-20T09:00:00-05:00',
    pago: {
      numeroOperacion: citaId === CITA_A ? 'OP12345678' : 'OP87654321',
      tieneCaptura: citaId === CITA_A,
      registradoEn: '2026-12-19T10:05:00-05:00',
      resultado: null,
      motivoRechazo: null,
    },
    devueltoEn: null,
    ...cambios,
  },
});

function sesion(rol: 'PROPIETARIO' | 'BARBERO') {
  return http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: {
        id: '0190a1b2-0000-7000-8000-000000000001',
        nombre: 'Rosa Quispe',
        correo: 'rosa@prueba.pe',
        rol,
        barberia: BARBERIA,
      },
    }),
  );
}

interface Recibidos {
  confirmadas: string[];
  rechazos: { citaId: string; cuerpo: unknown }[];
}

function servidorDeLaBandeja(
  inicial = [enBandeja(CITA_A, 'Luis Huamán'), enBandeja(CITA_B, 'Rocío Huamaní')],
) {
  let lista = inicial;
  const recibidos: Recibidos = { confirmadas: [], rechazos: [] };
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
    http.get('/api/v1/adelantos/por-revisar', () => HttpResponse.json(lista)),
    http.get(
      `/api/v1/citas/${CITA_A}/adelanto/captura`,
      () =>
        new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          headers: { 'Content-Type': 'image/png' },
        }),
    ),
    http.post('/api/v1/citas/:id/adelanto/confirmacion', ({ params }) => {
      recibidos.confirmadas.push(params.id as string);
      lista = lista.filter((x) => x.citaId !== params.id);
      return HttpResponse.json({ id: params.id, estado: 'CONFIRMADA' });
    }),
    http.post('/api/v1/citas/:id/adelanto/rechazo', async ({ params, request }) => {
      recibidos.rechazos.push({ citaId: params.id as string, cuerpo: await request.json() });
      lista = lista.filter((x) => x.citaId !== params.id);
      return HttpResponse.json({ citaId: params.id, estado: 'POR_PAGAR' });
    }),
  );
  return recibidos;
}

function renderizar(ruta = '/app/adelantos') {
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

const lista = () => screen.findByRole('list', { name: 'Pagos por revisar' });
const elementoDe = async (cliente: string) =>
  within(await lista())
    .getAllByRole('listitem')
    .find((li) => li.textContent?.includes(cliente)) as HTMLElement;

afterEach(() => {
  tokenEnMemoria.limpiar();
  vi.restoreAllMocks();
});

describe('Adelantos por revisar (/app/adelantos)', () => {
  it('el propietario la ve en el menú; un barbero no la ve ni puede abrirla', async () => {
    servidorDeLaBandeja();
    renderizar('/app');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).getByRole('link', { name: 'Adelantos por revisar' })).toHaveAttribute(
      'href',
      '/app/adelantos',
    );
  });

  it('un barbero que abre /app/adelantos vuelve al inicio, sin pedir la bandeja', async () => {
    const pedidas: string[] = [];
    servidor.use(
      sesion('BARBERO'),
      http.get('/api/v1/adelantos/por-revisar', () => {
        pedidas.push('GET');
        return HttpResponse.json([]);
      }),
    );
    renderizar();
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).queryByRole('link', { name: 'Adelantos por revisar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Adelantos por revisar' })).not.toBeInTheDocument();
    expect(pedidas).toEqual([]);
  });

  it('muestra cada pago con el cliente, el servicio, el monto, el código, el número y los dos plazos', async () => {
    servidorDeLaBandeja();
    renderizar();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Adelantos por revisar' }),
    ).toBeInTheDocument();
    const elementos = within(await lista()).getAllByRole('listitem');
    expect(elementos).toHaveLength(2);
    const a = elementos[0];
    expect(a).toHaveTextContent('Luis Huamán');
    expect(a).toHaveTextContent('Corte');
    expect(a).toHaveTextContent(/S\/\s?4\.00/);
    expect(a).toHaveTextContent('K7Q2MP');
    expect(a).toHaveTextContent('OP12345678');
    expect(a).toHaveTextContent('10:30 (hora de la barbería)');
    expect(a).toHaveTextContent('09:00 (hora de la barbería)');
    expect(elementos[1]).toHaveTextContent('Rocío Huamaní');
  });

  it('ver la captura abre una URL local (blob:) que no es del servidor', async () => {
    servidorDeLaBandeja();
    const crear = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:captura-1');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderizar();
    const a = await elementoDe('Luis Huamán');
    await userEvent.setup().click(within(a).getByRole('button', { name: /ver la captura/i }));
    const enlace = await within(a).findByRole('link', { name: /abrir la captura/i });
    expect(enlace).toHaveAttribute('href', 'blob:captura-1');
    expect(crear).toHaveBeenCalledTimes(1);
    // El pago sin captura no ofrece verla.
    const b = await elementoDe('Rocío Huamaní');
    expect(within(b).queryByRole('button', { name: /ver la captura/i })).not.toBeInTheDocument();
  });

  it('confirmar pide confirmación en un diálogo y luego confirma el pago', async () => {
    const recibidos = servidorDeLaBandeja();
    renderizar();
    const usuario = userEvent.setup();
    const a = await elementoDe('Luis Huamán');
    await usuario.click(within(a).getByRole('button', { name: /^confirmar/i }));
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Confirmar el pago del adelanto?' });
    expect(dialogo).toHaveTextContent(/S\/\s?4\.00/);
    expect(dialogo).toHaveTextContent('K7Q2MP');
    expect(recibidos.confirmadas).toEqual([]);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar pago' }));

    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(recibidos.confirmadas).toEqual([CITA_A]);
    expect(await screen.findByRole('list', { name: 'Pagos por revisar' })).not.toHaveTextContent(
      'Luis Huamán',
    );
  });

  it('rechazar exige el motivo (de 5 a 300 caracteres) y lo envía', async () => {
    const recibidos = servidorDeLaBandeja();
    renderizar();
    const usuario = userEvent.setup();
    const b = await elementoDe('Rocío Huamaní');
    await usuario.click(within(b).getByRole('button', { name: /^rechazar/i }));
    const dialogo = await screen.findByRole('dialog', { name: 'Rechazar el pago del adelanto' });
    await usuario.type(within(dialogo).getByLabelText('Motivo del rechazo'), 'no');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Rechazar pago' }));
    expect(
      await within(dialogo).findByText('Escribe el motivo del rechazo (de 5 a 300 caracteres).'),
    ).toBeInTheDocument();
    expect(within(dialogo).getByLabelText('Motivo del rechazo')).toHaveAttribute('aria-invalid', 'true');
    expect(recibidos.rechazos).toEqual([]);

    await usuario.clear(within(dialogo).getByLabelText('Motivo del rechazo'));
    await usuario.type(within(dialogo).getByLabelText('Motivo del rechazo'), 'No aparece en Yape');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Rechazar pago' }));
    expect(await screen.findByText('Pago rechazado')).toBeInTheDocument();
    expect(recibidos.rechazos).toEqual([{ citaId: CITA_B, cuerpo: { motivo: 'No aparece en Yape' } }]);
  });

  it('un error del servidor al confirmar se muestra con su mensaje', async () => {
    servidorDeLaBandeja();
    servidor.use(
      http.post('/api/v1/citas/:id/adelanto/confirmacion', () =>
        HttpResponse.json(
          { codigo: 'ADELANTO_RESUELTO', mensaje: 'Este adelanto ya fue resuelto.', detalles: [] },
          { status: 409 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const a = await elementoDe('Luis Huamán');
    await usuario.click(within(a).getByRole('button', { name: /^confirmar/i }));
    const dialogo = await screen.findByRole('alertdialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Confirmar pago' }));
    expect(await screen.findByText('Este adelanto ya fue resuelto.')).toBeInTheDocument();
  });

  it('sin pagos por revisar muestra el estado vacío', async () => {
    servidorDeLaBandeja([]);
    renderizar();
    expect(await screen.findByText('No hay pagos por revisar')).toBeInTheDocument();
  });

  it('mientras carga lo anuncia y, si falla, muestra el error', async () => {
    servidor.use(
      sesion('PROPIETARIO'),
      http.get('/api/v1/adelantos/por-revisar', async () => {
        await delay(150);
        return HttpResponse.json(
          {
            codigo: 'ERROR_INTERNO',
            mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.',
            detalles: [],
          },
          { status: 500 },
        );
      }),
    );
    renderizar();
    expect(await screen.findByText('Cargando los pagos por revisar…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Ocurrió un error inesperado. Intenta de nuevo.',
    );
  });

  it('se usa solo con el teclado: confirmar desde la lista y en el diálogo', async () => {
    const recibidos = servidorDeLaBandeja();
    renderizar();
    const usuario = userEvent.setup();
    const a = await elementoDe('Luis Huamán');
    const confirmar = within(a).getByRole('button', { name: /^confirmar/i });
    confirmar.focus();
    await usuario.keyboard('{Enter}');
    const dialogo = await screen.findByRole('alertdialog');
    // El foco queda dentro del diálogo: Tab hasta "Confirmar pago" y Enter.
    for (let i = 0; i < 3 && document.activeElement?.textContent !== 'Confirmar pago'; i += 1)
      await usuario.tab();
    expect(within(dialogo).getByRole('button', { name: 'Confirmar pago' })).toHaveFocus();
    await usuario.keyboard('{Enter}');
    expect(await screen.findByText('Pago confirmado')).toBeInTheDocument();
    expect(recibidos.confirmadas).toEqual([CITA_A]);
  });
});

// T056 de 008 (fase 6, US5): la pestaña "Por devolver" de la bandeja y "Marcar devuelto" (FR-022).
describe('Adelantos por revisar · pestaña Por devolver (T056)', () => {
  const porDevolver = (citaId: string, cliente: string) =>
    enBandeja(citaId, cliente, { estado: 'POR_DEVOLVER', pago: null });

  function servidorConPestanas(devolver = [porDevolver(CITA_A, 'Luis Huamán')]) {
    servidorDeLaBandeja();
    let lista = devolver;
    const pedidas: (string | null)[] = [];
    const devueltas: string[] = [];
    servidor.use(
      http.get('/api/v1/adelantos/por-revisar', ({ request }) => {
        const estado = new URL(request.url).searchParams.get('estado');
        pedidas.push(estado);
        return HttpResponse.json(estado === 'POR_DEVOLVER' ? lista : [enBandeja(CITA_B, 'Rocío Huamaní')]);
      }),
      http.post('/api/v1/citas/:id/adelanto/devolucion', ({ params }) => {
        devueltas.push(params.id as string);
        lista = lista.filter((x) => x.citaId !== params.id);
        return HttpResponse.json({
          ...porDevolver(params.id as string, '').adelanto,
          estado: 'DEVUELTO',
          devueltoEn: '2026-12-21T10:00:00-05:00',
        });
      }),
    );
    return { pedidas, devueltas };
  }

  it('dos pestañas; "Por devolver" pide la bandeja con estado=POR_DEVOLVER y se abre por la dirección', async () => {
    const { pedidas } = servidorConPestanas();
    renderizar('/app/adelantos?ver=por-devolver');
    const pestanas = await screen.findByRole('tablist', { name: 'Adelantos' });
    expect(within(pestanas).getByRole('tab', { name: 'Por devolver' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(within(pestanas).getByRole('tab', { name: 'Por revisar' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
    const panel = screen.getByRole('tabpanel', { name: 'Por devolver' });
    expect(await within(panel).findByRole('list', { name: 'Adelantos por devolver' })).toHaveTextContent(
      'Luis Huamán',
    );
    expect(pedidas).toContain('POR_DEVOLVER');
  });

  it('se cambia de pestaña con el teclado (flechas), como pide el patrón de pestañas', async () => {
    servidorConPestanas();
    renderizar();
    const usuario = userEvent.setup();
    const porRevisar = await screen.findByRole('tab', { name: 'Por revisar' });
    expect(porRevisar).toHaveAttribute('aria-selected', 'true');
    porRevisar.focus();
    await usuario.keyboard('{ArrowRight}');
    const devolver = screen.getByRole('tab', { name: 'Por devolver' });
    expect(devolver).toHaveFocus();
    expect(devolver).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('list', { name: 'Adelantos por devolver' })).toBeInTheDocument();
    await usuario.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Por revisar' })).toHaveAttribute('aria-selected', 'true');
  });

  it('"Marcar devuelto" pide confirmación, lo marca y el adelanto sale de la lista', async () => {
    const { devueltas } = servidorConPestanas();
    renderizar('/app/adelantos?ver=por-devolver');
    const usuario = userEvent.setup();
    const listaDevolver = await screen.findByRole('list', { name: 'Adelantos por devolver' });
    const fila = within(listaDevolver).getAllByRole('listitem')[0];
    expect(fila).toHaveTextContent(/S\/\s?4\.00/);
    expect(fila).toHaveTextContent('K7Q2MP');
    // Sin número de operación ni captura en esta pestaña.
    expect(fila).not.toHaveTextContent('OP12345678');
    await usuario.click(within(fila).getByRole('button', { name: /marcar devuelto/i }));
    const dialogo = await screen.findByRole('alertdialog', { name: '¿Marcar el adelanto como devuelto?' });
    expect(dialogo).toHaveTextContent(/S\/\s?4\.00/);
    expect(devueltas).toEqual([]);
    await usuario.click(within(dialogo).getByRole('button', { name: 'Marcar devuelto' }));
    expect(await screen.findByText('Adelanto marcado como devuelto')).toBeInTheDocument();
    expect(devueltas).toEqual([CITA_A]);
    expect(await screen.findByText('No hay adelantos por devolver')).toBeInTheDocument();
  });

  it('un error al marcar (409 ADELANTO_NO_POR_DEVOLVER) se muestra con su mensaje', async () => {
    servidorConPestanas();
    servidor.use(
      http.post('/api/v1/citas/:id/adelanto/devolucion', () =>
        HttpResponse.json(
          {
            codigo: 'ADELANTO_NO_POR_DEVOLVER',
            mensaje: 'Solo se puede marcar como devuelto un adelanto por devolver.',
            detalles: [],
          },
          { status: 409 },
        ),
      ),
    );
    renderizar('/app/adelantos?ver=por-devolver');
    const usuario = userEvent.setup();
    const listaDevolver = await screen.findByRole('list', { name: 'Adelantos por devolver' });
    await usuario.click(within(listaDevolver).getByRole('button', { name: /marcar devuelto/i }));
    const dialogo = await screen.findByRole('alertdialog');
    await usuario.click(within(dialogo).getByRole('button', { name: 'Marcar devuelto' }));
    expect(
      await screen.findByText('Solo se puede marcar como devuelto un adelanto por devolver.'),
    ).toBeInTheDocument();
  });

  it('sin adelantos por devolver muestra su estado vacío', async () => {
    servidorConPestanas([]);
    renderizar('/app/adelantos?ver=por-devolver');
    expect(await screen.findByText('No hay adelantos por devolver')).toBeInTheDocument();
  });
});

describe('Agenda con adelantos (T045)', () => {
  const HORA_MS = 60 * 60 * 1000;
  const futura = new Date(Date.now() + 3 * HORA_MS);
  const iso = (instante: Date) =>
    `${new Date(instante.getTime() - 5 * HORA_MS).toISOString().slice(0, 19)}-05:00`;

  it('una cita pendiente muestra el estado de su adelanto y el enlace a la bandeja', async () => {
    servidorDeLaBandeja();
    servidor.use(
      http.get('/api/v1/barberos', () => HttpResponse.json([])),
      http.get('/api/v1/servicios', () => HttpResponse.json([])),
      http.get('/api/v1/agenda', () =>
        HttpResponse.json({
          fecha: fechaIsoDeBarberia(new Date(), 'America/Lima'),
          zonaHoraria: 'America/Lima',
          citas: [
            {
              id: CITA_A,
              barberia: 'Barbería Huamanga',
              servicio: 'Corte',
              barbero: 'Luis',
              barberoId: '0190a1b2-0000-7000-8000-0000000000b1',
              inicio: iso(futura),
              fin: iso(new Date(futura.getTime() + HORA_MS / 2)),
              precio: '20.00',
              estado: 'PENDIENTE',
              cancelacionTardia: false,
              cancelacionTardiaDesde: iso(futura),
              origen: 'EN_LINEA',
              confirmadaPorClienteEn: null,
              enConflicto: false,
              cliente: { nombre: 'Luis Huamán', telefono: '966111222' },
              adelanto: enBandeja(CITA_A, 'Luis Huamán').adelanto,
            },
          ],
        }),
      ),
    );
    renderizar('/app/agenda');
    expect(await screen.findByText('Pago del adelanto por revisar')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Revisar pago' })).toHaveAttribute('href', '/app/adelantos');
  });
});
