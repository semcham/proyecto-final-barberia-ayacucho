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

// T078 · Transferencia con comprobante del propietario (US3; FR-019 a FR-021): los datos de la cuenta y la
// referencia, la subida con el archivo, el número y la fecha, el estado "en revisión", y el motivo del rechazo
// con la subida de otro.

const salirA = vi.hoisted(() => vi.fn());
vi.mock('../../src/navegacion', () => ({ salirA }));

const BARBERIA = {
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  nombre: 'Barbería Huamanga',
  slug: 'huamanga',
};
const BASICO = {
  id: '0190a1b2-0000-7000-8000-0000000000a1',
  codigo: 'BASICO',
  nombre: 'Básico',
  precioCentimos: 4900,
  moneda: 'PEN',
  maxUsuarios: 3,
  maxBarberos: 3,
  mediosDisponibles: ['YAPE', 'TRANSFERENCIA'],
};
const PAGO_ID = '0190a1b2-0000-7000-8000-0000000000f1';
const OTRO_PAGO_ID = '0190a1b2-0000-7000-8000-0000000000f2';
const REFERENCIA = 'SUS-3F4A5B202610XK7Q';

const pago = (estado: string, cambios: object = {}) => ({
  id: PAGO_ID,
  plan: { id: BASICO.id, nombre: 'Básico' },
  importeCentimos: 4900,
  moneda: 'PEN',
  medio: 'TRANSFERENCIA',
  estado,
  marca: null,
  periodo: null,
  motivoRechazo: null,
  numeroOperacionFinal: estado === 'EN_REVISION' ? '89AB' : null,
  creadoEn: '2026-10-28T15:00:00.000Z',
  aprobadoEn: null,
  ...cambios,
});

const suscripcion = (pagoAbierto: object | null) => ({
  estado: 'TRIAL',
  plan: {
    ...BASICO,
    id: '0190a1b2-0000-7000-8000-0000000000a0',
    codigo: 'TRIAL',
    nombre: 'Prueba',
    precioCentimos: 0,
    mediosDisponibles: [],
  },
  iniciaEn: '2026-10-20T15:00:00.000Z',
  finPrueba: '2026-11-03T15:00:00.000Z',
  finCobertura: '2026-11-03T15:00:00.000Z',
  finGracia: null,
  diasRestantes: 6,
  proximoPeriodo: null,
  limites: { maxUsuarios: 5, maxBarberos: 5 },
  motivoSuspension: null,
  pagoAbierto,
  avisos: [],
});

const iniciado = (id = PAGO_ID) => ({
  pago: pago('ESPERANDO_COMPROBANTE', { id }),
  urlPago: null,
  transferencia: {
    banco: 'Banco de Pruebas',
    titular: 'Plataforma de Barberías SAC',
    numeroCuenta: '191-0000000-0-00',
    cci: '00219100000000000000',
    importeCentimos: 4900,
    referencia: REFERENCIA,
  },
});

/**
 * Lee el cuerpo multipart como lo haría el servidor (el parser de undici no convive con el File de jsdom):
 * los campos de texto y el nombre y tamaño del archivo.
 */
async function leerMultipart(request: Request) {
  const tipo = request.headers.get('content-type') ?? '';
  expect(tipo).toMatch(/^multipart\/form-data; boundary=/);
  const limite = tipo.split('boundary=')[1];
  const texto = Buffer.from(await request.arrayBuffer()).toString('latin1');
  const campos: Record<string, string> = {};
  let archivo = { nombre: '', tamano: 0 };
  for (const parte of texto.split(`--${limite}`).slice(1, -1)) {
    const [cabecera, ...resto] = parte.replace(/^\r\n/, '').split('\r\n\r\n');
    const valor = resto.join('\r\n\r\n').replace(/\r\n$/, '');
    const nombre = /name="([^"]+)"/.exec(cabecera)?.[1] as string;
    const nombreArchivo = /filename="([^"]*)"/.exec(cabecera)?.[1];
    if (nombreArchivo !== undefined)
      archivo = { nombre: nombreArchivo, tamano: Buffer.from(valor, 'latin1').length };
    else campos[nombre] = Buffer.from(valor, 'latin1').toString('utf8');
  }
  return { campos, archivo };
}

interface Estado {
  abierto: object | null;
  pagos: { planId: string; medio: string }[];
  subidas: Record<string, string>[];
}

function servidorDelPanel(inicial: object | null): Estado {
  const estado: Estado = { abierto: inicial, pagos: [], subidas: [] };
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
    http.get('/api/v1/suscripcion', () => HttpResponse.json(suscripcion(estado.abierto))),
    http.get('/api/v1/planes', () => HttpResponse.json([BASICO])),
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
    http.post('/api/v1/suscripcion/pagos', async ({ request }) => {
      const cuerpo = (await request.json()) as { planId: string; medio: string };
      estado.pagos.push(cuerpo);
      const id = estado.abierto ? (estado.abierto as { id: string }).id : PAGO_ID;
      estado.abierto = pago('ESPERANDO_COMPROBANTE', { id });
      return HttpResponse.json(iniciado(id), { status: estado.pagos.length === 1 ? 201 : 200 });
    }),
    http.post('/api/v1/suscripcion/pagos/:id/comprobante', async ({ request, params }) => {
      const multipart = await leerMultipart(request);
      estado.subidas.push({
        pagoId: params.id as string,
        archivo: multipart.archivo.nombre,
        tamano: String(multipart.archivo.tamano),
        numeroOperacion: multipart.campos.numeroOperacion,
        fechaTransferencia: multipart.campos.fechaTransferencia,
      });
      estado.abierto = pago('EN_REVISION', { id: params.id });
      return HttpResponse.json(estado.abierto, { status: 201 });
    }),
  );
  return estado;
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

const PNG = () =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'voucher.png', {
    type: 'image/png',
  });

async function llenarYEnviar(usuario: ReturnType<typeof userEvent.setup>, archivo = PNG()) {
  const formulario = await screen.findByRole('form', { name: 'Comprobante de la transferencia' });
  await usuario.upload(within(formulario).getByLabelText('Voucher o captura de la transferencia'), archivo);
  await usuario.type(within(formulario).getByLabelText('Número de operación'), 'op-4567 89ab');
  await usuario.click(within(formulario).getByRole('button', { name: 'Enviar comprobante' }));
}

beforeEach(() => {
  salirA.mockReset();
});
afterEach(() => tokenEnMemoria.limpiar());

describe('Transferencia del propietario (/app/suscripcion)', () => {
  it('elegir un plan y pagar por transferencia muestra la cuenta, el importe exacto y la referencia', async () => {
    const estado = servidorDelPanel(null);
    renderizar();
    const usuario = userEvent.setup();
    await usuario.click(await screen.findByRole('radio', { name: /básico/i }));
    await usuario.click(screen.getByRole('button', { name: 'Pagar por transferencia' }));

    const datos = await screen.findByLabelText('Datos de la transferencia');
    expect(datos).toHaveTextContent('Banco de Pruebas');
    expect(datos).toHaveTextContent('Plataforma de Barberías SAC');
    expect(datos).toHaveTextContent('191-0000000-0-00');
    expect(datos).toHaveTextContent('00219100000000000000');
    expect(datos).toHaveTextContent(/S\/\s?49\.00/);
    expect(datos).toHaveTextContent(REFERENCIA);
    expect(estado.pagos[0]).toEqual({ planId: BASICO.id, medio: 'TRANSFERENCIA' });
    expect(salirA).not.toHaveBeenCalled();
  });

  it('sube el archivo con el número y la fecha, y muestra "comprobante en revisión"', async () => {
    const estado = servidorDelPanel(pago('ESPERANDO_COMPROBANTE'));
    renderizar();
    const usuario = userEvent.setup();
    await llenarYEnviar(usuario);

    expect(
      await screen.findByText(/Tu comprobante está en revisión \(operación terminada en 89AB\)/),
    ).toBeInTheDocument();
    expect(estado.subidas).toEqual([
      {
        pagoId: PAGO_ID,
        archivo: 'voucher.png',
        tamano: '11',
        numeroOperacion: 'op-4567 89ab',
        fechaTransferencia: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()),
      },
    ]);
    expect(screen.queryByRole('form', { name: 'Comprobante de la transferencia' })).not.toBeInTheDocument();
  });

  it('valida el archivo (más de 5 MB) y el número sin llamar al servidor', async () => {
    const estado = servidorDelPanel(pago('ESPERANDO_COMPROBANTE'));
    renderizar();
    const usuario = userEvent.setup();
    const formulario = await screen.findByRole('form', { name: 'Comprobante de la transferencia' });
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
    await usuario.upload(within(formulario).getByLabelText('Voucher o captura de la transferencia'), grande);
    await usuario.type(within(formulario).getByLabelText('Número de operación'), '12');
    await usuario.click(within(formulario).getByRole('button', { name: 'Enviar comprobante' }));
    expect(await within(formulario).findByText('El archivo pesa más de 5 MB.')).toBeInTheDocument();
    expect(within(formulario).getByText(/Escribe el número de operación del voucher/)).toBeInTheDocument();
    expect(estado.subidas).toEqual([]);
  });

  it('un tipo rechazado por el servidor (por sus bytes) muestra el motivo en palabras del propietario', async () => {
    servidorDelPanel(pago('ESPERANDO_COMPROBANTE'));
    servidor.use(
      http.post('/api/v1/suscripcion/pagos/:id/comprobante', () =>
        HttpResponse.json(
          {
            codigo: 'VALIDACION',
            mensaje: 'Revisa los datos del comprobante.',
            detalles: [{ campo: 'archivo', problema: 'tipo_no_permitido' }],
          },
          { status: 400 },
        ),
      ),
    );
    renderizar();
    await llenarYEnviar(userEvent.setup());
    expect(
      await screen.findByText('El archivo debe ser una imagen JPG o PNG, o un PDF.'),
    ).toBeInTheDocument();
  });

  it('el motivo del rechazo (desde el historial) y la subida de otro comprobante', async () => {
    const estado = servidorDelPanel(null);
    const rechazado = pago('RECHAZADO', { id: OTRO_PAGO_ID, motivoRechazo: 'El voucher no se lee' });
    servidor.use(
      // El pago más reciente del historial es la transferencia rechazada (hasta que se inicia otra).
      http.get('/api/v1/suscripcion/pagos', () =>
        HttpResponse.json({
          pagos: estado.abierto ? [estado.abierto, rechazado] : [rechazado],
          total: estado.abierto ? 2 : 1,
        }),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    expect(await screen.findByText(/Rechazamos tu comprobante: El voucher no se lee/)).toBeInTheDocument();
    await usuario.click(screen.getByRole('button', { name: 'Enviar otro comprobante' }));

    expect(await screen.findByRole('form', { name: 'Comprobante de la transferencia' })).toBeInTheDocument();
    expect(estado.pagos).toEqual([{ planId: BASICO.id, medio: 'TRANSFERENCIA' }]);
    await llenarYEnviar(usuario);
    expect(await screen.findByText(/Tu comprobante está en revisión/)).toBeInTheDocument();
    expect(estado.subidas).toHaveLength(1);
  });

  it('con el comprobante en revisión puede verlo como blob: que se revoca', async () => {
    servidorDelPanel(pago('EN_REVISION'));
    servidor.use(
      http.get(
        `/api/v1/suscripcion/pagos/${PAGO_ID}/comprobante`,
        () =>
          new HttpResponse(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
            headers: { 'Content-Type': 'image/png' },
          }),
      ),
    );
    const crear = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:propietario-1');
    const revocar = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    try {
      renderizar();
      const usuario = userEvent.setup();
      await usuario.click(await screen.findByRole('button', { name: 'Ver el comprobante enviado' }));
      const enlace = await screen.findByRole('link', { name: /Abrir el comprobante/ });
      expect(enlace).toHaveAttribute('href', 'blob:propietario-1');
      expect(crear).toHaveBeenCalledTimes(1);
      expect(revocar).not.toHaveBeenCalled();
    } finally {
      crear.mockRestore();
      revocar.mockRestore();
    }
  });
});
