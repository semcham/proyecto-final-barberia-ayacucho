import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenPlataforma } from '../../src/api/plataforma';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T095 · Barberías del administrador (US5; FR-034 a FR-036): listado con búsqueda y estados, suspender y reactivar
// la barbería o la suscripción con motivo y confirmación, y la activación manual con plan, motivo y referencia.

const HUAMANGA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-00000000aa01',
  nombre: 'Barbería Huamanga',
  slug: 'barberia-huamanga',
  estadoBarberia: 'ACTIVA',
  estadoSuscripcion: 'TRIAL',
  plan: 'Prueba gratuita',
  finCobertura: '2026-11-10T15:00:00.000Z',
};
const NORTE = {
  id: '0190a1b2-c3d4-7e5f-8a9b-00000000aa02',
  nombre: 'Corte Norte',
  slug: 'corte-norte',
  estadoBarberia: 'SUSPENDIDA',
  estadoSuscripcion: 'SUSPENDED',
  plan: 'Básico',
  finCobertura: '2026-11-01T15:00:00.000Z',
};
const PLANES = [
  {
    id: '01923a00-0000-7000-8000-000000000002',
    codigo: 'BASICO',
    nombre: 'Básico',
    precioCentimos: 4900,
    moneda: 'PEN',
    maxUsuarios: 3,
    maxBarberos: 3,
    mediosDisponibles: ['YAPE', 'TRANSFERENCIA'],
  },
  {
    id: '01923a00-0000-7000-8000-000000000003',
    codigo: 'PRO',
    nombre: 'Pro',
    precioCentimos: 8900,
    moneda: 'PEN',
    maxUsuarios: 8,
    maxBarberos: 8,
    mediosDisponibles: ['YAPE', 'TRANSFERENCIA'],
  },
];

interface Llamada {
  metodo: string;
  ruta: string;
  cuerpo: unknown;
}

function servidorPlataforma() {
  const estado = {
    barberias: [HUAMANGA, NORTE].map((b) => ({ ...b })),
    busquedas: [] as (string | null)[],
    llamadas: [] as Llamada[],
  };
  const registrar = async (request: Request, ruta: string) => {
    const texto = await request.text();
    estado.llamadas.push({ metodo: request.method, ruta, cuerpo: texto ? JSON.parse(texto) : null });
  };
  const barberia = (id: string) => estado.barberias.find((b) => b.id === id) as (typeof estado.barberias)[0];
  servidor.use(
    http.post('/api/v1/plataforma/auth/renovar', () =>
      HttpResponse.json({
        tokenAcceso: 'token-plataforma',
        tipo: 'Bearer',
        expiraEn: '2026-10-28T15:10:00.000Z',
      }),
    ),
    http.get('/api/v1/plataforma/barberias', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer token-plataforma');
      const buscar = new URL(request.url).searchParams.get('buscar');
      estado.busquedas.push(buscar);
      const filtradas = estado.barberias.filter(
        (b) => !buscar || `${b.nombre} ${b.slug}`.toLowerCase().includes(buscar.toLowerCase()),
      );
      return HttpResponse.json({ barberias: filtradas, total: filtradas.length });
    }),
    http.put('/api/v1/plataforma/barberias/:id/suspension', async ({ params, request }) => {
      await registrar(request, `barberia ${params.id}`);
      barberia(params.id as string).estadoBarberia = 'SUSPENDIDA';
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/plataforma/barberias/:id/suspension', async ({ params, request }) => {
      await registrar(request, `barberia ${params.id}`);
      barberia(params.id as string).estadoBarberia = 'ACTIVA';
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('/api/v1/plataforma/barberias/:id/suscripcion/suspension', async ({ params, request }) => {
      await registrar(request, `suscripcion ${params.id}`);
      barberia(params.id as string).estadoSuscripcion = 'SUSPENDED';
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('/api/v1/plataforma/barberias/:id/suscripcion/suspension', async ({ params, request }) => {
      await registrar(request, `suscripcion ${params.id}`);
      barberia(params.id as string).estadoSuscripcion = 'ACTIVE';
      return new HttpResponse(null, { status: 204 });
    }),
    http.get('/api/v1/plataforma/planes', () => HttpResponse.json(PLANES)),
    http.post('/api/v1/plataforma/barberias/:id/activacion-manual', async ({ params, request }) => {
      await registrar(request, `activacion ${params.id}`);
      return HttpResponse.json(
        {
          id: '0190a1b2-0000-7000-8000-0000000000f1',
          plan: { id: PLANES[1].id, nombre: 'Pro' },
          importeCentimos: 8900,
          moneda: 'PEN',
          medio: 'MANUAL',
          estado: 'APROBADO',
          marca: null,
          periodo: { iniciaEn: '2026-11-10T15:00:00.000Z', terminaEn: '2026-12-10T15:00:00.000Z' },
          motivoRechazo: null,
          motivoActivacion: 'La pasarela no procesó el pago',
          numeroOperacionFinal: null,
          creadoEn: '2026-10-28T15:00:00.000Z',
          aprobadoEn: '2026-10-28T15:00:00.000Z',
        },
        { status: 201 },
      );
    }),
  );
  return estado;
}

function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/plataforma/barberias']}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const filas = async () =>
  within(await screen.findByRole('list', { name: 'Barberías' })).getAllByRole('listitem');
const filaDe = async (nombre: string) =>
  (await filas()).find((fila) => within(fila).queryByText(nombre)) as HTMLElement;

beforeEach(() => tokenPlataforma.limpiar());
afterEach(() => tokenPlataforma.limpiar());

describe('Barberías (/plataforma/barberias)', () => {
  it('lista cada barbería con su enlace, plan, cobertura y estados; busca por nombre o enlace', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const [huamanga, norte] = await filas();
    expect(huamanga).toHaveTextContent('Barbería Huamanga');
    expect(huamanga).toHaveTextContent('/barberia-huamanga');
    expect(huamanga).toHaveTextContent('plan Prueba gratuita');
    expect(huamanga).toHaveTextContent('cubierta hasta el');
    expect(huamanga).toHaveTextContent('Barbería activa');
    expect(huamanga).toHaveTextContent('Suscripción: En prueba');
    expect(norte).toHaveTextContent('Barbería suspendida');
    expect(norte).toHaveTextContent('Suscripción: Suspendida');
    expect(within(norte).getByRole('button', { name: 'Reactivar barbería' })).toBeInTheDocument();
    expect(within(norte).getByRole('button', { name: 'Reactivar suscripción' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Barberías' })).toHaveAttribute('aria-current', 'page');

    const usuario = userEvent.setup();
    await usuario.type(screen.getByLabelText('Buscar por nombre o enlace'), '  norte ');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(async () => expect(await filas()).toHaveLength(1));
    expect(estado.busquedas.at(-1)).toBe('norte');
    expect((await filas())[0]).toHaveTextContent('Corte Norte');

    await usuario.clear(screen.getByLabelText('Buscar por nombre o enlace'));
    await usuario.type(screen.getByLabelText('Buscar por nombre o enlace'), 'nada');
    await usuario.click(screen.getByRole('button', { name: 'Buscar' }));
    expect(await screen.findByText('Ninguna barbería coincide')).toBeInTheDocument();
  });

  it('suspender la barbería pide el motivo y una confirmación; cancelar no envía nada', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const fila = await filaDe('Barbería Huamanga');
    await usuario.click(within(fila).getByRole('button', { name: 'Suspender barbería' }));
    const formulario = within(fila).getByRole('form', { name: 'Suspender barbería' });
    await usuario.click(within(formulario).getByRole('button', { name: 'Suspender barbería' }));
    expect(await within(formulario).findByText(/Escribe el motivo/)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    await usuario.type(
      within(formulario).getByLabelText('Motivo de la suspensión de la barbería'),
      'Incumplimiento de los términos',
    );
    await usuario.click(within(formulario).getByRole('button', { name: 'Suspender barbería' }));
    const confirmacion = await screen.findByRole('alertdialog', {
      name: '¿Suspender la barbería Barbería Huamanga?',
    });
    expect(confirmacion).toHaveTextContent('no podrán iniciar sesión');
    expect(confirmacion).toHaveTextContent('No se borra nada');
    await usuario.click(within(confirmacion).getByRole('button', { name: 'Cancelar' }));
    expect(estado.llamadas).toEqual([]);

    await usuario.click(within(formulario).getByRole('button', { name: 'Suspender barbería' }));
    await usuario.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Suspender barbería' }),
    );
    expect(await screen.findByText('Se suspendió la barbería')).toBeInTheDocument();
    expect(estado.llamadas).toEqual([
      {
        metodo: 'PUT',
        ruta: `barberia ${HUAMANGA.id}`,
        cuerpo: { motivo: 'Incumplimiento de los términos' },
      },
    ]);
    await waitFor(async () =>
      expect(await filaDe('Barbería Huamanga')).toHaveTextContent('Barbería suspendida'),
    );
    expect(
      within(await filaDe('Barbería Huamanga')).getByRole('button', { name: 'Reactivar barbería' }),
    ).toBeInTheDocument();
  });

  it('suspender la suscripción con motivo, y reactivar barbería y suscripción con confirmación', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const huamanga = await filaDe('Barbería Huamanga');
    await usuario.click(within(huamanga).getByRole('button', { name: 'Suspender suscripción' }));
    const formulario = within(huamanga).getByRole('form', { name: 'Suspender suscripción' });
    await usuario.type(
      within(formulario).getByLabelText('Motivo de la suspensión de la suscripción'),
      'Contracargo sin resolver',
    );
    await usuario.click(within(formulario).getByRole('button', { name: 'Suspender suscripción' }));
    const confirmacion = await screen.findByRole('alertdialog');
    expect(confirmacion).toHaveTextContent('el propietario verá el motivo');
    await usuario.click(within(confirmacion).getByRole('button', { name: 'Suspender suscripción' }));
    expect(await screen.findByText('Se suspendió la suscripción')).toBeInTheDocument();

    const norte = await filaDe('Corte Norte');
    await usuario.click(within(norte).getByRole('button', { name: 'Reactivar barbería' }));
    const reactivar = await screen.findByRole('alertdialog', { name: '¿Reactivar la barbería Corte Norte?' });
    expect(reactivar).toHaveTextContent('estado que le corresponde por sus fechas');
    await usuario.click(within(reactivar).getByRole('button', { name: 'Reactivar' }));
    expect(await screen.findByText('Se reactivó la barbería')).toBeInTheDocument();

    await usuario.click(
      within(await filaDe('Corte Norte')).getByRole('button', { name: 'Reactivar suscripción' }),
    );
    await usuario.click(
      within(
        await screen.findByRole('alertdialog', { name: '¿Reactivar la suscripción de Corte Norte?' }),
      ).getByRole('button', { name: 'Reactivar' }),
    );
    expect(await screen.findByText('Se reactivó la suscripción')).toBeInTheDocument();
    expect(estado.llamadas).toEqual([
      { metodo: 'PUT', ruta: `suscripcion ${HUAMANGA.id}`, cuerpo: { motivo: 'Contracargo sin resolver' } },
      { metodo: 'DELETE', ruta: `barberia ${NORTE.id}`, cuerpo: null },
      { metodo: 'DELETE', ruta: `suscripcion ${NORTE.id}`, cuerpo: null },
    ]);
  });

  it('la activación manual pide plan, motivo y referencia, confirma con el precio y envía los tres', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const fila = await filaDe('Barbería Huamanga');
    await usuario.click(within(fila).getByRole('button', { name: 'Activar plan a mano' }));
    const formulario = within(fila).getByRole('form', { name: 'Activar un plan a mano' });
    await usuario.click(within(formulario).getByRole('button', { name: 'Activar plan' }));
    expect(await within(formulario).findByText('Elige el plan.')).toBeInTheDocument();
    expect(within(formulario).getByText(/Escribe el motivo/)).toBeInTheDocument();
    expect(within(formulario).getByText(/Escribe la referencia/)).toBeInTheDocument();

    const plan = await within(formulario).findByRole('option', { name: /^Pro · S\/\s89\.00 al mes$/ });
    await usuario.selectOptions(within(formulario).getByLabelText('Plan'), plan);
    await usuario.type(within(formulario).getByLabelText('Motivo'), 'La pasarela no procesó el pago');
    await usuario.type(within(formulario).getByLabelText('Referencia del pago externo'), 'DEP-778812');
    await usuario.click(within(formulario).getByRole('button', { name: 'Activar plan' }));
    const confirmacion = await screen.findByRole('alertdialog', {
      name: '¿Activar el plan Pro para Barbería Huamanga?',
    });
    expect(confirmacion).toHaveTextContent('activación manual');
    expect(confirmacion).toHaveTextContent('S/ 89.00');
    await usuario.click(within(confirmacion).getByRole('button', { name: 'Activar plan' }));

    expect(await screen.findByText('Plan activado a mano')).toBeInTheDocument();
    expect(estado.llamadas).toEqual([
      {
        metodo: 'POST',
        ruta: `activacion ${HUAMANGA.id}`,
        cuerpo: {
          planId: PLANES[1].id,
          motivo: 'La pasarela no procesó el pago',
          referenciaExterna: 'DEP-778812',
        },
      },
    ]);
    await waitFor(() =>
      expect(within(fila).queryByRole('form', { name: 'Activar un plan a mano' })).not.toBeInTheDocument(),
    );
  });

  it('un 409 de la activación muestra el mensaje del servidor', async () => {
    servidorPlataforma();
    servidor.use(
      http.post('/api/v1/plataforma/barberias/:id/activacion-manual', () =>
        HttpResponse.json(
          {
            codigo: 'PAGO_ADELANTADO_NO_PERMITIDO',
            mensaje: 'Ya hay un período pagado por adelantado.',
            detalles: [],
          },
          { status: 409 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const fila = await filaDe('Barbería Huamanga');
    await usuario.click(within(fila).getByRole('button', { name: 'Activar plan a mano' }));
    const formulario = within(fila).getByRole('form', { name: 'Activar un plan a mano' });
    await usuario.selectOptions(
      within(formulario).getByLabelText('Plan'),
      await within(formulario).findByRole('option', { name: /^Básico · S\/\s49\.00 al mes$/ }),
    );
    await usuario.type(within(formulario).getByLabelText('Motivo'), 'Pago en efectivo en la oficina');
    await usuario.type(within(formulario).getByLabelText('Referencia del pago externo'), 'REC-0042');
    await usuario.click(within(formulario).getByRole('button', { name: 'Activar plan' }));
    await usuario.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Activar plan' }),
    );
    expect(
      await within(formulario).findByText('Ya hay un período pagado por adelantado.'),
    ).toBeInTheDocument();
  });
});
