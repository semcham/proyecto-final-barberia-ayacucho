import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T048 · Pantallas del panel para preparar la barbería (US1): Barbería (horario y enlace), Servicios (alta y
// desactivación con conflicto), Barberos (vínculo y límite del plan) y Disponibilidad (semana y bloqueo).

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'barberia-huamanga',
};
const PROPIETARIO = {
  id: '0190a1b2-0000-7000-8000-000000000001',
  nombre: 'Rosa Quispe',
  correo: 'rosa@prueba.pe',
};
const LUIS = { id: '0190a1b2-0000-7000-8000-000000000002', nombre: 'Luis Huamán', correo: 'luis@prueba.pe' };
const CORTE = '0190a1b2-0000-7000-8000-0000000000c1';
const CARLOS = '0190a1b2-0000-7000-8000-0000000000b1';
const BARBERO_LUIS = '0190a1b2-0000-7000-8000-0000000000b2';

const CONFIG = {
  nombre: 'Barbería Huamanga',
  slug: 'barberia-huamanga',
  direccion: null,
  telefono: null,
  descripcion: null,
  zonaHoraria: 'America/Lima',
  antelacionCancelacionMinutos: 120,
};
const SEMANA = {
  tramos: [1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio: '09:00', fin: '19:00' })),
};
const SERVICIO = {
  id: CORTE,
  nombre: 'Corte clásico',
  descripcion: null,
  precio: '25.00',
  duracionMinutos: 30,
  activo: true,
};
const BARBEROS = [
  { id: CARLOS, nombre: 'Carlos Ñaupa', activo: true, servicioIds: [CORTE], usuarioId: null },
  { id: BARBERO_LUIS, nombre: 'Luis', activo: true, servicioIds: [CORTE], usuarioId: LUIS.id },
];
const CONFLICTO = (n: number) =>
  HttpResponse.json(
    {
      codigo: 'CONFLICTO_CON_CITAS',
      mensaje: 'El cambio deja citas activas en conflicto.',
      detalles: Array.from({ length: n }, (_, i) => ({
        id: `0190a1b2-0000-7000-8000-00000000099${i}`,
        inicio: `2026-10-2${i}T18:00:00-05:00`,
        barberoId: CARLOS,
        servicio: 'Corte clásico',
      })),
    },
    { status: 409 },
  );

function sesion(rol: 'PROPIETARIO' | 'BARBERO') {
  const persona = rol === 'PROPIETARIO' ? PROPIETARIO : LUIS;
  return http.post('/api/v1/auth/refresh', () =>
    HttpResponse.json({
      tokenAcceso: `token-${rol}`,
      tipo: 'Bearer',
      expiraEn: 900,
      usuario: { ...persona, rol, barberia: BARBERIA },
    }),
  );
}

/** Lecturas comunes del panel. */
function lecturas(rol: 'PROPIETARIO' | 'BARBERO' = 'PROPIETARIO') {
  servidor.use(
    sesion(rol),
    http.get('/api/v1/barberia', () => HttpResponse.json(CONFIG)),
    http.get('/api/v1/barberia/horario', () => HttpResponse.json(SEMANA)),
    http.get('/api/v1/servicios', () => HttpResponse.json([SERVICIO])),
    http.get('/api/v1/barberos', () => HttpResponse.json(BARBEROS)),
    http.get('/api/v1/usuarios', () =>
      HttpResponse.json({
        datos: [
          { ...PROPIETARIO, rol: 'PROPIETARIO', estado: 'ACTIVA', creadoEn: '2026-10-15T15:00:00Z' },
          { ...LUIS, rol: 'BARBERO', estado: 'ACTIVA', creadoEn: '2026-10-15T15:00:00Z' },
        ],
        total: 2,
        pagina: 1,
        tamano: 100,
      }),
    ),
    http.get('/api/v1/barberos/:id/disponibilidad', () => HttpResponse.json(SEMANA)),
    http.get('/api/v1/barberos/:id/bloqueos', () => HttpResponse.json([])),
  );
}

function renderizar(ruta: string) {
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

const cambiar = (etiqueta: string | RegExp, valor: string) =>
  fireEvent.change(screen.getByLabelText(etiqueta), { target: { value: valor } });

afterEach(() => tokenEnMemoria.limpiar());

describe('Barbería (/app/barberia)', () => {
  it('valida el horario antes de enviarlo: un cierre anterior a la apertura no se guarda', async () => {
    lecturas();
    let enviados = 0;
    servidor.use(
      http.put('/api/v1/barberia/horario', () => {
        enviados += 1;
        return HttpResponse.json(SEMANA);
      }),
    );
    renderizar('/app/barberia');
    await screen.findByLabelText('Lunes, cierre del tramo 1');
    cambiar('Lunes, cierre del tramo 1', '08:00');
    await userEvent.setup().click(screen.getByRole('button', { name: /guardar horario/i }));
    expect(await screen.findByText(/lunes: el cierre debe ser posterior a la apertura/i)).toBeInTheDocument();
    expect(enviados).toBe(0);
  });

  it('avisa que el enlace anterior deja de funcionar y envía solo lo que cambió', async () => {
    lecturas();
    let cuerpo: unknown;
    servidor.use(
      http.patch('/api/v1/barberia', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json({ ...CONFIG, slug: 'huamanga-centro' });
      }),
    );
    renderizar('/app/barberia');
    const enlace = await screen.findByLabelText(/^enlace$/i);
    expect(screen.getByText(/\/b\/barberia-huamanga/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copiar enlace/i })).toBeInTheDocument();
    expect(screen.queryByText(/el enlace anterior dejará de funcionar/i)).not.toBeInTheDocument();

    const usuario = userEvent.setup();
    await usuario.clear(enlace);
    await usuario.type(enlace, 'huamanga-centro');
    expect(screen.getByText(/el enlace anterior dejará de funcionar/i)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: /guardar datos/i }));
    await screen.findByText(/datos guardados/i);
    expect(cuerpo).toEqual({ slug: 'huamanga-centro' });
  });

  it('si el horario deja citas fuera, muestra las citas afectadas y guarda solo al confirmar', async () => {
    lecturas();
    const cuerpos: { confirmarConflictos?: boolean }[] = [];
    servidor.use(
      http.put('/api/v1/barberia/horario', async ({ request }) => {
        const cuerpo = (await request.json()) as { confirmarConflictos?: boolean };
        cuerpos.push(cuerpo);
        return cuerpo.confirmarConflictos ? HttpResponse.json(SEMANA) : CONFLICTO(1);
      }),
    );
    renderizar('/app/barberia');
    await screen.findByLabelText('Lunes, cierre del tramo 1');
    cambiar('Lunes, cierre del tramo 1', '13:00');
    const usuario = userEvent.setup();
    await usuario.click(screen.getByRole('button', { name: /guardar horario/i }));
    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent(/1 cita/i);
    expect(modal).toHaveTextContent('Corte clásico');
    await usuario.click(within(modal).getByRole('button', { name: /guardar de todos modos/i }));
    await screen.findByText(/horario guardado/i);
    expect(cuerpos.map((c) => c.confirmarConflictos ?? false)).toEqual([false, true]);
  });
});

describe('Servicios (/app/servicios)', () => {
  it('agrega un servicio con nombre, precio y duración', async () => {
    lecturas();
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/servicios', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json({ ...SERVICIO, id: 'nuevo', nombre: 'Barba' }, { status: 201 });
      }),
    );
    renderizar('/app/servicios');
    expect(await screen.findByText('Corte clásico')).toBeInTheDocument();
    const usuario = userEvent.setup();
    const formulario = screen.getByRole('form', { name: /nuevo servicio/i });
    await usuario.type(within(formulario).getByLabelText(/^nombre$/i), 'Barba');
    await usuario.type(within(formulario).getByLabelText(/precio/i), '15.5');
    await usuario.clear(within(formulario).getByLabelText(/duración/i));
    await usuario.type(within(formulario).getByLabelText(/duración/i), '20');
    await usuario.click(within(formulario).getByRole('button', { name: /agregar servicio/i }));
    await screen.findByText(/servicio agregado/i);
    expect(cuerpo).toEqual({ nombre: 'Barba', precio: '15.5', duracionMinutos: 20, descripcion: null });
  });

  it('desactivar con citas futuras abre la confirmación con la cantidad y solo entonces desactiva', async () => {
    lecturas();
    const cuerpos: Record<string, unknown>[] = [];
    servidor.use(
      http.patch(`/api/v1/servicios/${CORTE}`, async ({ request }) => {
        const cuerpo = (await request.json()) as Record<string, unknown>;
        cuerpos.push(cuerpo);
        return cuerpo.confirmarConflictos ? HttpResponse.json({ ...SERVICIO, activo: false }) : CONFLICTO(2);
      }),
    );
    renderizar('/app/servicios');
    const fila = (await screen.findByText('Corte clásico')).closest('li') as HTMLElement;
    const usuario = userEvent.setup();
    await usuario.click(within(fila).getByRole('button', { name: /desactivar/i }));
    const modal = await screen.findByRole('alertdialog');
    expect(modal).toHaveTextContent(/2 citas futuras/i);
    await usuario.click(within(modal).getByRole('button', { name: /desactivar de todos modos/i }));
    await screen.findByText(/servicio desactivado/i);
    expect(cuerpos).toEqual([{ activo: false }, { activo: false, confirmarConflictos: true }]);
  });
});

describe('Barberos (/app/barberos)', () => {
  it('crea un barbero con sus servicios y vinculado a un usuario del personal', async () => {
    lecturas();
    let cuerpo: unknown;
    servidor.use(
      http.get('/api/v1/barberos', () => HttpResponse.json([BARBEROS[0]])),
      http.post('/api/v1/barberos', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json(
          { id: 'nuevo', nombre: 'Luis', activo: true, servicioIds: [CORTE], usuarioId: LUIS.id },
          { status: 201 },
        );
      }),
    );
    renderizar('/app/barberos');
    const formulario = await screen.findByRole('form', { name: /nuevo barbero/i });
    const usuario = userEvent.setup();
    await usuario.type(within(formulario).getByLabelText(/nombre visible/i), 'Luis');
    await usuario.click(within(formulario).getByRole('checkbox', { name: 'Corte clásico' }));
    await usuario.selectOptions(within(formulario).getByLabelText(/usuario vinculado/i), 'Luis Huamán');
    await usuario.click(within(formulario).getByRole('button', { name: /agregar barbero/i }));
    await screen.findByText(/barbero agregado/i);
    expect(cuerpo).toEqual({ nombre: 'Luis', servicioIds: [CORTE], usuarioId: LUIS.id });
  });

  it('muestra el límite del plan cuando no se pueden agregar más barberos', async () => {
    lecturas();
    servidor.use(
      http.post('/api/v1/barberos', () =>
        HttpResponse.json(
          {
            codigo: 'SUSCRIPCION_NO_PERMITE',
            mensaje: 'Tu plan no permite más barberos activos.',
            detalles: [{ motivo: 'LIMITE_BARBEROS', maximo: 5 }],
          },
          { status: 403 },
        ),
      ),
    );
    renderizar('/app/barberos');
    const formulario = await screen.findByRole('form', { name: /nuevo barbero/i });
    const usuario = userEvent.setup();
    await usuario.type(within(formulario).getByLabelText(/nombre visible/i), 'Pedro');
    await usuario.click(within(formulario).getByRole('button', { name: /agregar barbero/i }));
    expect(await within(formulario).findByRole('alert')).toHaveTextContent(
      /tu plan permite hasta 5 barberos activos/i,
    );
  });
});

describe('Disponibilidad (/app/disponibilidad)', () => {
  it('el propietario elige un barbero y guarda su semana', async () => {
    lecturas();
    let cuerpo: { tramos: { diaSemana: number; inicio: string; fin: string }[] } | undefined;
    servidor.use(
      http.put(`/api/v1/barberos/${BARBERO_LUIS}/disponibilidad`, async ({ request }) => {
        cuerpo = (await request.json()) as typeof cuerpo;
        return HttpResponse.json(cuerpo);
      }),
    );
    renderizar('/app/disponibilidad');
    const usuario = userEvent.setup();
    await usuario.selectOptions(await screen.findByLabelText(/^barbero$/i), 'Luis');
    await screen.findByLabelText('Lunes, cierre del tramo 1');
    cambiar('Lunes, cierre del tramo 1', '14:00');
    await usuario.click(screen.getByRole('button', { name: /guardar disponibilidad/i }));
    await screen.findByText(/disponibilidad guardada/i);
    expect(cuerpo?.tramos).toContainEqual({ diaSemana: 1, inicio: '09:00', fin: '14:00' });
    expect(cuerpo?.tramos).toHaveLength(6);
  });

  it('un bloqueo que choca con citas pide confirmación y se crea al confirmar, en la hora de la barbería', async () => {
    lecturas();
    const cuerpos: Record<string, unknown>[] = [];
    servidor.use(
      http.post(`/api/v1/barberos/${CARLOS}/bloqueos`, async ({ request }) => {
        const cuerpo = (await request.json()) as Record<string, unknown>;
        cuerpos.push(cuerpo);
        return cuerpo.confirmarConflictos
          ? HttpResponse.json(
              { id: 'b1', barberoId: CARLOS, inicio: cuerpo.inicio, fin: cuerpo.fin, motivo: 'Trámite' },
              { status: 201 },
            )
          : CONFLICTO(1);
      }),
    );
    renderizar('/app/disponibilidad');
    const formulario = await screen.findByRole('form', { name: /nuevo bloqueo/i });
    fireEvent.change(within(formulario).getByLabelText(/fecha de inicio/i), {
      target: { value: '2026-10-20' },
    });
    fireEvent.change(within(formulario).getByLabelText(/hora de inicio/i), { target: { value: '10:00' } });
    fireEvent.change(within(formulario).getByLabelText(/fecha de fin/i), { target: { value: '2026-10-20' } });
    fireEvent.change(within(formulario).getByLabelText(/hora de fin/i), { target: { value: '12:00' } });
    const usuario = userEvent.setup();
    await usuario.type(within(formulario).getByLabelText(/motivo/i), 'Trámite');
    await usuario.click(within(formulario).getByRole('button', { name: /agregar bloqueo/i }));
    const modal = await screen.findByRole('alertdialog');
    await usuario.click(within(modal).getByRole('button', { name: /bloquear de todos modos/i }));
    await screen.findByText(/bloqueo agregado/i);
    expect(cuerpos).toEqual([
      { inicio: '2026-10-20T10:00:00-05:00', fin: '2026-10-20T12:00:00-05:00', motivo: 'Trámite' },
      {
        inicio: '2026-10-20T10:00:00-05:00',
        fin: '2026-10-20T12:00:00-05:00',
        motivo: 'Trámite',
        confirmarConflictos: true,
      },
    ]);
  });

  it('el barbero solo ve la disponibilidad del barbero vinculado a su usuario', async () => {
    lecturas('BARBERO');
    const pedidas: string[] = [];
    servidor.use(
      http.get('/api/v1/barberos/:id/disponibilidad', ({ params }) => {
        pedidas.push(params.id as string);
        return HttpResponse.json(SEMANA);
      }),
    );
    renderizar('/app/disponibilidad');
    await screen.findByLabelText('Lunes, cierre del tramo 1');
    expect(screen.queryByLabelText(/^barbero$/i)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /semana de luis/i })).toBeInTheDocument();
    expect(pedidas).toEqual([BARBERO_LUIS]);
  });
});
