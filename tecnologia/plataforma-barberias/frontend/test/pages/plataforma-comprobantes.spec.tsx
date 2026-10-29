import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tokenPlataforma } from '../../src/api/plataforma';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { servidor } from '../setup';

// T078 · Comprobantes por revisar del administrador (US3; FR-022 a FR-024; R09): la cola con el número ya
// usado, el archivo visto como blob: que se revoca a los 60 s, el número completo solo en el detalle, aprobar
// con el importe y rechazar con motivo.

const BARBERIA_A = { id: '0190a1b2-c3d4-7e5f-8a9b-00000000aa01', nombre: 'Barbería Huamanga' };
const BARBERIA_B = { id: '0190a1b2-c3d4-7e5f-8a9b-00000000bb01', nombre: 'Barbería Wari' };
const PAGO_A = '0190a1b2-0000-7000-8000-0000000000a1';
const PAGO_B = '0190a1b2-0000-7000-8000-0000000000b1';

const item = (barberia: typeof BARBERIA_A, pagoId: string, cambios: object = {}) => ({
  barberia,
  pago: {
    id: pagoId,
    plan: 'Básico',
    importeCentimos: 4900,
    referencia: `SUS-${pagoId.slice(-6).toUpperCase()}202610AB12`,
    numeroOperacionFinal: '1234',
    numeroRepetido: false,
    fechaTransferencia: '2026-10-27',
    pagoIniciadoEn: '2026-10-26T15:00:00.000Z',
    fechaAnteriorAlPago: false,
    numeroYaUsadoEn: [],
    ...cambios,
  },
  enviadoEn: '2026-10-28T15:00:00.000Z',
});

interface Estado {
  cola: ReturnType<typeof item>[];
  revisiones: { barberia: string; pago: string; cuerpo: unknown }[];
}

function servidorPlataforma(): Estado {
  const estado: Estado = {
    cola: [
      item(BARBERIA_A, PAGO_A, {
        numeroRepetido: true,
        numeroYaUsadoEn: ['0190a1b2-0000-7000-8000-0000000000ff'],
      }),
      item(BARBERIA_B, PAGO_B, { numeroYaUsadoEn: ['0190a1b2-0000-7000-8000-0000000000ee'] }),
    ],
    revisiones: [],
  };
  servidor.use(
    http.post('/api/v1/plataforma/auth/renovar', () =>
      HttpResponse.json({
        tokenAcceso: 'token-plataforma',
        tipo: 'Bearer',
        expiraEn: '2026-10-28T15:10:00.000Z',
      }),
    ),
    http.get('/api/v1/plataforma/comprobantes', ({ request }) => {
      expect(request.headers.get('authorization')).toBe('Bearer token-plataforma');
      return HttpResponse.json(estado.cola);
    }),
    http.get('/api/v1/plataforma/barberias/:barberia/pagos/:pago', ({ params }) =>
      HttpResponse.json({
        pago: { id: params.pago, estado: 'EN_REVISION', importeCentimos: 4900 },
        numeroOperacion: 'OPERACION9871234',
        fechaTransferencia: '2026-10-27',
      }),
    ),
    http.get(
      '/api/v1/plataforma/barberias/:barberia/pagos/:pago/comprobante',
      () =>
        new HttpResponse(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1]), {
          headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment' },
        }),
    ),
    http.post('/api/v1/plataforma/barberias/:barberia/pagos/:pago/revision', async ({ params, request }) => {
      estado.revisiones.push({
        barberia: params.barberia as string,
        pago: params.pago as string,
        cuerpo: await request.json(),
      });
      estado.cola = estado.cola.filter((c) => c.pago.id !== params.pago);
      return HttpResponse.json({ id: params.pago, estado: 'APROBADO' });
    }),
  );
  return estado;
}

function renderizar() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/plataforma/comprobantes']}>
        <SesionProvider>
          <RutasApp />
        </SesionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const tarjetaDe = async (nombre: string) =>
  (await screen.findByRole('heading', { name: nombre })).closest('li') as HTMLElement;

beforeEach(() => tokenPlataforma.limpiar());
afterEach(() => {
  tokenPlataforma.limpiar();
  vi.useRealTimers();
});

describe('Comprobantes por revisar (/plataforma/comprobantes)', () => {
  it('la cola señala el número ya usado y el archivo repetido, y solo muestra los últimos 4 del número', async () => {
    servidorPlataforma();
    renderizar();
    const a = await tarjetaDe('Barbería Huamanga');
    expect(within(a).getByText('Número ya usado')).toBeInTheDocument();
    expect(within(a).getByText('•••• 1234')).toBeInTheDocument();
    expect(within(a).getByText(/ya figura en otro pago/)).toBeInTheDocument();
    const b = await tarjetaDe('Barbería Wari');
    expect(within(b).getByText('Archivo repetido')).toBeInTheDocument();
    expect(within(b).queryByText('Número ya usado')).not.toBeInTheDocument();
    expect(screen.queryByText('OPERACION9871234')).not.toBeInTheDocument();
  });

  it('FR-020b: la fecha anterior al pago se señala con el día de inicio en hora de Lima, y se puede aprobar', async () => {
    const estado = servidorPlataforma();
    // Iniciado a las 22:00 del 27 en Lima (03:00 del 28 en UTC); la transferencia dice el 20.
    estado.cola = [
      item(BARBERIA_B, PAGO_B, {
        fechaTransferencia: '2026-10-20',
        pagoIniciadoEn: '2026-10-28T03:00:00.000Z',
        fechaAnteriorAlPago: true,
      }),
    ];
    renderizar();
    const b = await tarjetaDe('Barbería Wari');
    expect(within(b).getByText('Fecha anterior al pago')).toBeInTheDocument();
    expect(within(b).getByRole('note')).toHaveTextContent(
      'La transferencia tiene fecha 2026-10-20, anterior al día en que se inició el pago (2026-10-27)',
    );
    // El día de inicio que se muestra es el de Lima, no el de UTC.
    expect(within(b).queryByText('2026-10-28')).not.toBeInTheDocument();

    // La marca no bloquea: se aprueba igual.
    const usuario = userEvent.setup();
    await usuario.click(within(b).getByRole('button', { name: 'Aprobar' }));
    await usuario.type(within(b).getByLabelText(/Importe recibido/), '49');
    await usuario.click(within(b).getByRole('button', { name: 'Confirmar la aprobación' }));
    expect(await screen.findByText('Comprobante aprobado')).toBeInTheDocument();
    expect(estado.revisiones).toHaveLength(1);
  });

  it('sin la marca no aparece el aviso de fecha', async () => {
    servidorPlataforma();
    renderizar();
    const b = await tarjetaDe('Barbería Wari');
    expect(within(b).queryByText('Fecha anterior al pago')).not.toBeInTheDocument();
    expect(within(b).getByText('2026-10-26')).toBeInTheDocument();
  });

  it('el número completo solo aparece al pedir el detalle', async () => {
    servidorPlataforma();
    renderizar();
    const a = await tarjetaDe('Barbería Huamanga');
    await userEvent.setup().click(within(a).getByRole('button', { name: 'Ver número completo' }));
    expect(await within(a).findByText('OPERACION9871234')).toBeInTheDocument();
  });

  it('ve el comprobante como una URL blob: que se revoca a los 60 segundos', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    servidorPlataforma();
    const crear = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:comprobante-1');
    const revocar = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      renderizar();
      const usuario = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const a = await tarjetaDe('Barbería Huamanga');
      await usuario.click(within(a).getByRole('button', { name: 'Ver comprobante' }));
      const enlace = await within(a).findByRole('link', { name: /Abrir el comprobante/ });
      expect(enlace).toHaveAttribute('href', 'blob:comprobante-1');
      expect(crear).toHaveBeenCalledWith(expect.any(Blob));
      expect(revocar).not.toHaveBeenCalled();

      await act(async () => {
        vi.advanceTimersByTime(60_000);
      });
      expect(revocar).toHaveBeenCalledWith('blob:comprobante-1');
      expect(within(a).queryByRole('link', { name: /Abrir el comprobante/ })).not.toBeInTheDocument();
    } finally {
      crear.mockRestore();
      revocar.mockRestore();
    }
  });

  it('aprueba con el importe en soles (enviado en céntimos) y el pago sale de la cola', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const b = await tarjetaDe('Barbería Wari');
    await usuario.click(within(b).getByRole('button', { name: 'Aprobar' }));
    const formulario = within(b).getByRole('form', { name: 'Aprobar el pago de Barbería Wari' });
    await usuario.type(within(formulario).getByLabelText(/Importe recibido/), '49.00');
    await usuario.click(within(formulario).getByRole('button', { name: 'Confirmar la aprobación' }));

    expect(await screen.findByText('Comprobante aprobado')).toBeInTheDocument();
    expect(estado.revisiones).toEqual([
      {
        barberia: BARBERIA_B.id,
        pago: PAGO_B,
        cuerpo: { resultado: 'APROBADO', importeTransferidoCentimos: 4900 },
      },
    ]);
    await vi.waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Barbería Wari' })).not.toBeInTheDocument(),
    );
  });

  it('rechaza con motivo (y no sin él)', async () => {
    const estado = servidorPlataforma();
    renderizar();
    const usuario = userEvent.setup();
    const a = await tarjetaDe('Barbería Huamanga');
    await usuario.click(within(a).getByRole('button', { name: 'Rechazar' }));
    const formulario = within(a).getByRole('form', { name: 'Rechazar el pago de Barbería Huamanga' });
    await usuario.click(within(formulario).getByRole('button', { name: 'Confirmar el rechazo' }));
    expect(await within(formulario).findByText(/Explica el motivo/)).toBeInTheDocument();
    expect(estado.revisiones).toEqual([]);

    await usuario.type(
      within(formulario).getByLabelText('Motivo del rechazo'),
      'Número de operación repetido',
    );
    await usuario.click(within(formulario).getByRole('button', { name: 'Confirmar el rechazo' }));
    expect(await screen.findByText('Comprobante rechazado')).toBeInTheDocument();
    expect(estado.revisiones).toEqual([
      {
        barberia: BARBERIA_A.id,
        pago: PAGO_A,
        cuerpo: { resultado: 'RECHAZADO', motivo: 'Número de operación repetido' },
      },
    ]);
  });

  it('un 409 del servidor (número ya aprobado) muestra su mensaje y el pago sigue en la cola', async () => {
    servidorPlataforma();
    servidor.use(
      http.post('/api/v1/plataforma/barberias/:barberia/pagos/:pago/revision', () =>
        HttpResponse.json(
          {
            codigo: 'NUMERO_OPERACION_YA_APROBADO',
            mensaje: 'Ese número de operación ya se aprobó en otro pago',
            detalles: [],
          },
          { status: 409 },
        ),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const a = await tarjetaDe('Barbería Huamanga');
    await usuario.click(within(a).getByRole('button', { name: 'Aprobar' }));
    await usuario.type(within(a).getByLabelText(/Importe recibido/), '49');
    await usuario.click(within(a).getByRole('button', { name: 'Confirmar la aprobación' }));
    expect(
      await within(a).findByText('Ese número de operación ya se aprobó en otro pago'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Barbería Huamanga' })).toBeInTheDocument();
  });

  it('sin comprobantes muestra la cola al día', async () => {
    servidorPlataforma();
    servidor.use(http.get('/api/v1/plataforma/comprobantes', () => HttpResponse.json([])));
    renderizar();
    expect(await screen.findByText('No hay comprobantes por revisar')).toBeInTheDocument();
  });
});
