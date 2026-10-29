import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T088 · Historial de pagos del propietario (US4; FR-025): los estados con los textos del contrato, la marca
// "pago duplicado (en revisión)", el motivo del rechazo, los últimos 4 del número de operación y la paginación.

vi.mock('../../src/navegacion', () => ({ salirA: vi.fn() }));

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};

let n = 0;
const pago = (estado: string, cambios: object = {}) => {
  n += 1;
  return {
    id: `0190a1b2-0000-7000-8000-${String(n).padStart(12, '0')}`,
    plan: { id: '0190a1b2-0000-7000-8000-0000000000a1', nombre: 'Básico' },
    importeCentimos: 4900,
    moneda: 'PEN',
    medio: 'YAPE',
    estado,
    marca: null,
    periodo: null,
    motivoRechazo: null,
    numeroOperacionFinal: null,
    creadoEn: '2026-10-28T15:00:00.000Z',
    aprobadoEn: null,
    ...cambios,
  };
};

function servidorDelPanel(paginas: Record<number, { pagos: object[]; total: number }>) {
  const pedidas: number[] = [];
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token-propietario',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: {
          id: '0190a1b2-0000-7000-8000-000000000001',
          nombre: 'Rosa Quispe',
          correo: 'rosa@prueba.pe',
          rol: 'PROPIETARIO',
          barberia: BARBERIA,
        },
      }),
    ),
    http.get('/api/v1/planes', () => HttpResponse.json([])),
    http.get('/api/v1/barberos', () => HttpResponse.json([])),
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
    http.get('/api/v1/suscripcion/pagos', ({ request }) => {
      const pagina = Number(new URL(request.url).searchParams.get('pagina') ?? '1');
      pedidas.push(pagina);
      return HttpResponse.json(paginas[pagina] ?? { pagos: [], total: 0 });
    }),
  );
  return pedidas;
}

function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/app/suscripcion']}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => tokenEnMemoria.limpiar());

describe('Historial de pagos (/app/suscripcion)', () => {
  it('muestra cada pago con el texto de su estado, la marca de duplicado y el motivo del rechazo', async () => {
    servidorDelPanel({
      1: {
        total: 6,
        pagos: [
          pago('APROBADO', {
            marca: 'DUPLICADO',
            aprobadoEn: '2026-10-28T15:01:00.000Z',
          }),
          pago('APROBADO', {
            medio: 'TRANSFERENCIA',
            numeroOperacionFinal: '89AB',
            periodo: { iniciaEn: '2026-11-03T15:00:00.000Z', terminaEn: '2026-12-03T15:00:00.000Z' },
          }),
          pago('RECHAZADO', { medio: 'TRANSFERENCIA', motivoRechazo: 'El voucher no se lee' }),
          pago('EN_REVISION', { medio: 'TRANSFERENCIA' }),
          pago('PENDIENTE'),
          pago('ESPERANDO_COMPROBANTE', { medio: 'TRANSFERENCIA' }),
        ],
      },
    });
    renderizar();
    const lista = await screen.findByRole('list', { name: 'Pagos' });
    const filas = within(lista).getAllByRole('listitem');
    expect(filas).toHaveLength(6);
    expect(filas[0]).toHaveTextContent('pago duplicado (en revisión)');
    expect(filas[1]).toHaveTextContent('aprobado');
    expect(filas[1]).toHaveTextContent('Transferencia');
    expect(filas[1]).toHaveTextContent('operación terminada en 89AB');
    expect(filas[1]).toHaveTextContent(/período del/);
    expect(filas[2]).toHaveTextContent('rechazado');
    expect(filas[2]).toHaveTextContent('Motivo: El voucher no se lee');
    expect(filas[3]).toHaveTextContent('comprobante en revisión');
    expect(filas[4]).toHaveTextContent('pendiente de confirmación');
    expect(filas[5]).toHaveTextContent('esperando comprobante');
    for (const fila of filas) expect(fila).toHaveTextContent(/S\/\s?49\.00/);
    // Sin paginación con una sola página.
    expect(screen.queryByRole('navigation', { name: 'Páginas del historial' })).not.toBeInTheDocument();
  });

  it('pagina de a 20: siguientes y anteriores', async () => {
    const primera = Array.from({ length: 20 }, () => pago('ANULADO'));
    const segunda = [pago('EXPIRADO', { importeCentimos: 8900, plan: { id: 'x', nombre: 'Pro' } })];
    const pedidas = servidorDelPanel({
      1: { pagos: primera, total: 21 },
      2: { pagos: segunda, total: 21 },
    });
    renderizar();
    const usuario = userEvent.setup();
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Pagos' })).getAllByRole('listitem')).toHaveLength(20);
    expect(screen.getByRole('button', { name: 'Anteriores' })).toBeDisabled();

    await usuario.click(screen.getByRole('button', { name: 'Siguientes' }));
    expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
    const filas = within(screen.getByRole('list', { name: 'Pagos' })).getAllByRole('listitem');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toHaveTextContent('expirado');
    expect(filas[0]).toHaveTextContent('Pro');
    expect(screen.getByRole('button', { name: 'Siguientes' })).toBeDisabled();
    expect(pedidas).toContain(2);

    await usuario.click(screen.getByRole('button', { name: 'Anteriores' }));
    expect(await screen.findByText('Página 1 de 2')).toBeInTheDocument();
  });

  it('sin pagos muestra el historial vacío', async () => {
    servidorDelPanel({});
    renderizar();
    expect(await screen.findByText('Aún no hay pagos')).toBeInTheDocument();
  });
});
