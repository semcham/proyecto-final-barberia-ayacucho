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

// T088 · Pagos por revisar del administrador (US4; FR-025a): cada marca con su texto, la notificación sin pago
// sin acción, y la resolución con nota que saca el caso de la lista.

const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-00000000aa01', nombre: 'Barbería Huamanga' };
const caso = (marca: string, n: number, cambios: object = {}) => ({
  marca,
  barberia: BARBERIA,
  pagoId: `0190a1b2-0000-7000-8000-00000000000${n}`,
  eventoId: null,
  importeCentimos: 4900,
  detectadoEn: `2026-10-2${n}T15:00:00.000Z`,
  ...cambios,
});

function servidorPlataforma() {
  const estado = {
    casos: [
      caso('DUPLICADO', 1),
      caso('IMPORTE_DISTINTO', 2),
      caso('APROBADO_TRAS_RECHAZO', 3),
      caso('DEVOLUCION', 4),
      caso('SIN_PAGO', 5, {
        barberia: null,
        pagoId: null,
        eventoId: 'evt_desconocido_123',
        importeCentimos: 3100,
      }),
    ],
    resoluciones: [] as { pago: string; barberia: string; cuerpo: unknown }[],
  };
  servidor.use(
    http.post('/api/v1/plataforma/auth/renovar', () =>
      HttpResponse.json({
        tokenAcceso: 'token-plataforma',
        tipo: 'Bearer',
        expiraEn: '2026-10-28T15:10:00.000Z',
      }),
    ),
    http.get('/api/v1/plataforma/pagos/por-revisar', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer token-plataforma');
      return HttpResponse.json(estado.casos);
    }),
    http.post(
      '/api/v1/plataforma/barberias/:barberia/pagos/:pago/revision/resolucion',
      async ({ params, request }) => {
        estado.resoluciones.push({
          pago: params.pago as string,
          barberia: params.barberia as string,
          cuerpo: await request.json(),
        });
        estado.casos = estado.casos.filter((c) => c.pagoId !== params.pago);
        return new HttpResponse(null, { status: 204 });
      },
    ),
  );
  return estado;
}

function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/plataforma/pagos-por-revisar']}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const filas = async () =>
  within(await screen.findByRole('list', { name: 'Pagos por revisar' })).getAllByRole('listitem');

beforeEach(() => tokenPlataforma.limpiar());
afterEach(() => tokenPlataforma.limpiar());

describe('Pagos por revisar (/plataforma/pagos-por-revisar)', () => {
  it('cada marca con su texto; la notificación sin pago no tiene acción y muestra el evento', async () => {
    servidorPlataforma();
    renderizar();
    const lista = await filas();
    expect(lista).toHaveLength(5);
    expect(lista[0]).toHaveTextContent('Pago duplicado');
    expect(lista[1]).toHaveTextContent('Importe distinto');
    expect(lista[2]).toHaveTextContent('Aprobado tras un rechazo');
    expect(lista[3]).toHaveTextContent('Devolución o contracargo');
    expect(lista[4]).toHaveTextContent('Notificación sin pago');
    expect(lista[4]).toHaveTextContent('evt_desconocido_123');
    expect(lista[4]).toHaveTextContent('Sin barbería');
    expect(within(lista[4]).queryByRole('form')).not.toBeInTheDocument();
    for (const fila of lista.slice(0, 4)) expect(within(fila).getByRole('form')).toBeInTheDocument();
  });

  it('resolver con nota envía la nota y saca el caso de la lista; sin nota no envía nada', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const [duplicado] = await filas();
    const formulario = within(duplicado).getByRole('form');
    await usuario.click(within(formulario).getByRole('button', { name: 'Marcar como resuelto' }));
    expect(await within(formulario).findByText(/Escribe la nota/)).toBeInTheDocument();
    expect(estado.resoluciones).toEqual([]);

    await usuario.type(
      within(formulario).getByLabelText('Nota de la resolución'),
      'Devuelto por Yape, operación 4521',
    );
    await usuario.click(within(formulario).getByRole('button', { name: 'Marcar como resuelto' }));
    expect(await screen.findByText('Caso resuelto')).toBeInTheDocument();
    expect(estado.resoluciones).toEqual([
      {
        pago: '0190a1b2-0000-7000-8000-000000000001',
        barberia: BARBERIA.id,
        cuerpo: { motivo: 'Devuelto por Yape, operación 4521' },
      },
    ]);
    await waitFor(async () => expect(await filas()).toHaveLength(4));
    expect(screen.queryByText('Pago duplicado')).not.toBeInTheDocument();
  });

  it('un 409 (ya resuelto) muestra el mensaje del servidor', async () => {
    servidorPlataforma();
    servidor.use(
      http.post('/api/v1/plataforma/barberias/:barberia/pagos/:pago/revision/resolucion', () =>
        HttpResponse.json(
          { codigo: 'PAGO_YA_REVISADO', mensaje: 'Este pago ya fue revisado', detalles: [] },
          { status: 409 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const [duplicado] = await filas();
    await usuario.type(
      within(duplicado).getByLabelText('Nota de la resolución'),
      'Devuelto por transferencia',
    );
    await usuario.click(within(duplicado).getByRole('button', { name: 'Marcar como resuelto' }));
    expect(await within(duplicado).findByText('Este pago ya fue revisado')).toBeInTheDocument();
  });

  it('sin casos muestra que todo está al día', async () => {
    servidorPlataforma();
    servidor.use(http.get('/api/v1/plataforma/pagos/por-revisar', () => HttpResponse.json([])));
    renderizar();
    expect(await screen.findByText('No hay pagos por revisar')).toBeInTheDocument();
  });
});
