import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T042 · Pantalla de suscripción del propietario (US1; FR-001, FR-005a, FR-008 a FR-012, SC-005): estado en
// prueba con fechas y días, planes con su precio, "Pagar con Yape" lleva a la página del proveedor, al volver
// consulta el pago hasta verlo aprobado, el 503 muestra el mensaje con la transferencia, y el aviso FR-005a
// compara los límites del plan elegido con los usuarios y barberos activos.

const salirA = vi.hoisted(() => vi.fn());
vi.mock('../../src/navegacion', () => ({ salirA }));

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};
const PROPIETARIO = {
  id: '0190a1b2-0000-7000-8000-000000000001',
  nombre: 'Rosa Quispe',
  correo: 'rosa@prueba.pe',
};
const PLAN = (codigo: string, nombre: string, precio: number, max: number) => ({
  id: `0190a1b2-0000-7000-8000-0000000000${codigo === 'BASICO' ? 'a1' : codigo === 'PRO' ? 'a2' : 'a0'}`,
  codigo,
  nombre,
  precioCentimos: precio,
  moneda: 'PEN',
  maxUsuarios: max,
  maxBarberos: max,
  mediosDisponibles: precio > 0 ? ['YAPE'] : [],
});
const TRIAL = PLAN('TRIAL', 'Prueba gratuita', 0, 5);
const BASICO = PLAN('BASICO', 'Básico', 4900, 3);
const PRO = PLAN('PRO', 'Pro', 8900, 8);

const SUSCRIPCION = {
  estado: 'TRIAL',
  plan: TRIAL,
  iniciaEn: '2026-10-20T15:00:00.000Z',
  finPrueba: '2026-11-03T15:00:00.000Z',
  finCobertura: '2026-11-03T15:00:00.000Z',
  finGracia: null,
  diasRestantes: 6,
  proximoPeriodo: null,
  limites: { maxUsuarios: 5, maxBarberos: 5 },
  motivoSuspension: null,
  pagoAbierto: null,
  avisos: [],
};
const PAGO = (estado: string) => ({
  id: '0190a1b2-0000-7000-8000-0000000000f1',
  plan: { id: BASICO.id, nombre: 'Básico' },
  importeCentimos: 4900,
  moneda: 'PEN',
  medio: 'YAPE',
  estado,
  marca: null,
  periodo:
    estado === 'APROBADO'
      ? { iniciaEn: '2026-11-03T15:00:00.000Z', terminaEn: '2026-12-03T15:00:00.000Z' }
      : null,
  motivoRechazo: null,
  numeroOperacionFinal: null,
  creadoEn: '2026-10-28T15:00:00.000Z',
  aprobadoEn: estado === 'APROBADO' ? '2026-10-28T15:01:00.000Z' : null,
});

const persona = (i: number, estado = 'ACTIVA') => ({
  id: `0190a1b2-0000-7000-8000-00000000010${i}`,
  nombre: `Persona ${i}`,
  correo: `p${i}@prueba.pe`,
  rol: i === 0 ? 'PROPIETARIO' : 'BARBERO',
  estado,
  creadoEn: '2026-10-15T15:00:00Z',
});

function lecturas(opciones: { usuarios?: number; barberos?: number; suscripcion?: object } = {}) {
  const usuarios = Array.from({ length: opciones.usuarios ?? 2 }, (_, i) => persona(i));
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token-propietario',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: { ...PROPIETARIO, rol: 'PROPIETARIO', barberia: BARBERIA },
      }),
    ),
    http.get('/api/v1/suscripcion', () => HttpResponse.json({ ...SUSCRIPCION, ...opciones.suscripcion })),
    http.get('/api/v1/planes', () => HttpResponse.json([BASICO, PRO])),
    http.get('/api/v1/usuarios', () =>
      HttpResponse.json({
        datos: [...usuarios, persona(9, 'DESACTIVADA')],
        total: usuarios.length + 1,
        pagina: 1,
        tamano: 100,
      }),
    ),
    http.get('/api/v1/barberos', () =>
      HttpResponse.json(
        Array.from({ length: opciones.barberos ?? 2 }, (_, i) => ({
          id: `0190a1b2-0000-7000-8000-0000000002${i}0`,
          nombre: `Barbero ${i}`,
          activo: true,
          servicioIds: [],
          usuarioId: null,
        })),
      ),
    ),
  );
}

function renderizar(ruta = '/app/suscripcion') {
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

beforeEach(() => salirA.mockReset());
afterEach(() => tokenEnMemoria.limpiar());

describe('Suscripción (/app/suscripcion)', () => {
  it('muestra el estado "En prueba" con su fecha de fin y los días restantes', async () => {
    lecturas();
    renderizar();
    const estado = await screen.findByRole('region', { name: /tu suscripción/i });
    expect(within(estado).getByText('En prueba')).toBeInTheDocument();
    expect(within(estado).getByText(/6 días/)).toBeInTheDocument();
    expect(within(estado).getByText(/3 de noviembre de 2026/)).toBeInTheDocument();
    expect(within(estado).getByText(/5 usuarios y 5 barberos/)).toBeInTheDocument();
  });

  it('lista los planes con su precio mensual', async () => {
    lecturas();
    renderizar();
    expect(await screen.findByRole('radio', { name: /básico/i })).toBeInTheDocument();
    expect(screen.getByText(/S\/\s?49\.00/)).toBeInTheDocument();
    expect(screen.getByText(/S\/\s?89\.00/)).toBeInTheDocument();
  });

  it('"Pagar con Yape" lleva a la página del proveedor', async () => {
    lecturas();
    let cuerpo: unknown;
    servidor.use(
      http.post('/api/v1/suscripcion/pagos', async ({ request }) => {
        cuerpo = await request.json();
        return HttpResponse.json(
          {
            pago: PAGO('PENDIENTE'),
            urlPago: 'https://pasarela.example/checkout/ses_1',
            transferencia: null,
          },
          { status: 201 },
        );
      }),
    );
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('radio', { name: /básico/i }));
    await usuario.click(screen.getByRole('button', { name: /pagar con yape/i }));
    await vi.waitFor(() => expect(salirA).toHaveBeenCalledWith('https://pasarela.example/checkout/ses_1'));
    expect(cuerpo).toEqual({ planId: BASICO.id, medio: 'YAPE' });
  });

  it('al volver con ?pago= consulta el pago hasta verlo aprobado', async () => {
    lecturas();
    let consultas = 0;
    servidor.use(
      http.get('/api/v1/suscripcion/pagos/:id', () => {
        consultas += 1;
        return HttpResponse.json(PAGO(consultas < 2 ? 'PENDIENTE' : 'APROBADO'));
      }),
    );
    renderizar(`/app/suscripcion?pago=${PAGO('PENDIENTE').id}`);
    expect(await screen.findByText(/confirmando tu pago/i)).toBeInTheDocument();
    expect(await screen.findByText(/pago aprobado/i)).toBeInTheDocument();
    expect(consultas).toBeGreaterThanOrEqual(2);
  });

  it('con la pasarela caída muestra el mensaje con la opción de transferencia', async () => {
    lecturas();
    servidor.use(
      http.post('/api/v1/suscripcion/pagos', () =>
        HttpResponse.json(
          {
            codigo: 'PAGO_EN_LINEA_NO_DISPONIBLE',
            mensaje: 'El pago en línea no está disponible ahora. Puedes pagar por transferencia bancaria.',
            detalles: [{ alternativa: 'TRANSFERENCIA' }],
          },
          { status: 503 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('radio', { name: /básico/i }));
    await usuario.click(screen.getByRole('button', { name: /pagar con yape/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/transferencia bancaria/i);
    expect(salirA).not.toHaveBeenCalled();
  });

  it('avisa si el plan elegido tiene límites menores que lo que la barbería usa hoy (FR-005a)', async () => {
    // 5 usuarios activos (el desactivado no cuenta) y 4 barberos activos frente a BÁSICO (3 y 3).
    lecturas({ usuarios: 5, barberos: 4 });
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('radio', { name: /básico/i }));
    const aviso = await screen.findByText(/el plan básico permite 3 usuarios y 3 barberos/i);
    expect(aviso).toHaveTextContent(/tienes 5 usuarios y 4 barberos activos/i);
    expect(aviso).toHaveTextContent(/nada se desactiva solo/i);
    await usuario.click(screen.getByRole('radio', { name: /pro/i }));
    expect(screen.queryByText(/el plan pro permite/i)).not.toBeInTheDocument();
  });

  it('el menú del propietario lleva a la suscripción', async () => {
    lecturas();
    renderizar('/app/suscripcion');
    const navegacion = await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(navegacion).getByRole('link', { name: /suscripción/i })).toHaveAttribute(
      'href',
      '/app/suscripcion',
    );
  });
});
