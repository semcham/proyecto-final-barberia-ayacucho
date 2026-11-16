import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tokenPlataforma } from '../../src/api/plataforma';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T031 de 007 · Indicadores de la plataforma (/plataforma/indicadores; US2, FR-012 a FR-016): el administrador ve las
// barberías activas, suspendidas y por estado de la suscripción, en tablas con encabezados (sin gráficos), y la hora
// del cálculo. Sin citasPorMes ni usuarios (fase 2b), esas secciones no aparecen, ni siquiera en cero. Solo con la
// sesión de la plataforma.

const SOLO_BARBERIAS = {
  calculadoEn: '2026-11-16T15:30:00.000Z',
  barberias: {
    activas: 7,
    suspendidas: 1,
    porEstadoDeSuscripcion: [
      { estado: 'TRIAL', barberias: 4 },
      { estado: 'ACTIVE', barberias: 2 },
      { estado: 'PAST_DUE', barberias: 1 },
      { estado: 'EXPIRED', barberias: 1 },
      { estado: 'SUSPENDED', barberias: 0 },
      { estado: 'CANCELLED', barberias: 0 },
    ],
  },
};

function servidorIndicadores(cuerpo: Record<string, unknown> = SOLO_BARBERIAS) {
  const pedidos: string[] = [];
  servidor.use(
    http.post('/api/v1/plataforma/auth/renovar', () =>
      HttpResponse.json({
        tokenAcceso: 'token-plataforma',
        tipo: 'Bearer',
        expiraEn: '2026-11-16T15:40:00.000Z',
      }),
    ),
    http.get('/api/v1/plataforma/indicadores', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer token-plataforma');
      pedidos.push('GET');
      return HttpResponse.json(cuerpo);
    }),
  );
  return pedidos;
}

function renderizar(ruta = '/plataforma/indicadores') {
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

const filasDe = (tabla: HTMLElement) =>
  within(tabla)
    .getAllByRole('row')
    .slice(1)
    .map((fila) =>
      within(fila)
        .getAllByRole('cell')
        .map((celda) => celda.textContent?.trim()),
    );

beforeEach(() => tokenPlataforma.limpiar());
afterEach(() => tokenPlataforma.limpiar());

describe('Indicadores de la plataforma (/plataforma/indicadores)', () => {
  it('está en el menú de la plataforma', async () => {
    servidorIndicadores();
    renderizar('/plataforma');
    const menu = await screen.findByRole('navigation', { name: 'Plataforma' });
    expect(within(menu).getByRole('link', { name: /indicadores/i })).toHaveAttribute(
      'href',
      '/plataforma/indicadores',
    );
  });

  it('muestra las barberías activas, suspendidas y por estado en tablas con encabezados, y la hora del cálculo', async () => {
    servidorIndicadores();
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Indicadores' })).toBeInTheDocument();

    const resumen = await screen.findByRole('table', { name: 'Barberías' });
    expect(
      within(resumen)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Indicador', 'Barberías']);
    expect(filasDe(resumen)).toEqual([
      ['Activas', '7'],
      ['Suspendidas por la plataforma', '1'],
    ]);

    const porEstado = screen.getByRole('table', { name: 'Barberías por estado de la suscripción' });
    expect(
      within(porEstado)
        .getAllByRole('columnheader')
        .map((c) => c.textContent),
    ).toEqual(['Estado de la suscripción', 'Barberías']);
    expect(filasDe(porEstado)).toEqual([
      ['En prueba', '4'],
      ['Activa', '2'],
      ['En período de gracia', '1'],
      ['Vencida', '1'],
      ['Suspendida', '0'],
      ['Cancelada', '0'],
    ]);

    // La hora del cálculo, como texto y como <time> legible por máquina.
    const hora = screen.getByText(/calculado el/i);
    expect(hora.querySelector('time')).toHaveAttribute('dateTime', SOLO_BARBERIAS.calculadoEn);
    // Sin gráficos.
    expect(document.querySelector('svg[role="img"], canvas')).toBeNull();
  });

  it('sin citasPorMes ni usuarios, esas secciones no aparecen (ni en cero)', async () => {
    servidorIndicadores();
    renderizar();
    await screen.findByRole('table', { name: 'Barberías' });
    expect(screen.queryByRole('table', { name: /citas/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: /usuarios/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /citas por mes/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /usuarios/i })).not.toBeInTheDocument();
  });

  it('si el cálculo falla, lo dice y permite reintentar', async () => {
    let intentos = 0;
    servidor.use(
      http.post('/api/v1/plataforma/auth/renovar', () =>
        HttpResponse.json({
          tokenAcceso: 'token-plataforma',
          tipo: 'Bearer',
          expiraEn: '2026-11-16T15:40:00.000Z',
        }),
      ),
      http.get('/api/v1/plataforma/indicadores', () => {
        intentos += 1;
        return intentos === 1
          ? HttpResponse.json(
              { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error.', detalles: [] },
              { status: 500 },
            )
          : HttpResponse.json(SOLO_BARBERIAS);
      }),
    );
    renderizar();
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se pudieron calcular los indicadores/i);
    await userEvent.setup().click(screen.getByRole('button', { name: /intentar de nuevo/i }));
    expect(await screen.findByRole('table', { name: 'Barberías' })).toBeInTheDocument();
  });

  it('solo con la sesión de la plataforma: sin ella, va a ingresar y no pide los indicadores', async () => {
    const pedidos: string[] = [];
    servidor.use(
      http.post('/api/v1/plataforma/auth/renovar', () =>
        HttpResponse.json(
          { codigo: 'NO_AUTENTICADO', mensaje: 'Inicia sesión.', detalles: [] },
          { status: 401 },
        ),
      ),
      http.get('/api/v1/plataforma/indicadores', () => {
        pedidos.push('GET');
        return HttpResponse.json(SOLO_BARBERIAS);
      }),
    );
    renderizar();
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Indicadores' })).not.toBeInTheDocument();
    expect(pedidos).toEqual([]);
  });
});
