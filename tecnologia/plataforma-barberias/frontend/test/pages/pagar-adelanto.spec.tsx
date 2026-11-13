import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tokenEnMemoria } from '../../src/api/client';
import { SesionProvider } from '../../src/auth/SesionProvider';
import { RutasApp } from '../../src/routes';
import { QR_DE_PRUEBA } from '../msw-handlers';
import { servidor } from '../setup';

// T027 de 008 · Pagar el adelanto (/mis-citas/:citaId/adelanto; US2, FR-008 a FR-011): el QR, el monto, el código
// (copiable) y la hora límite en texto; registrar el número con o sin captura; los mensajes del 409 y del 422; los
// estados por pagar, por revisar, rechazado, confirmado y vencido; el enlace desde Mis citas; y todo con el teclado.

const SLUG = 'barberia-huamanga';
const BARBERIA = { id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', nombre: 'Barbería Huamanga', slug: SLUG };
const CITA_ID = '0190a1b2-c3d4-7e5f-8a9b-000000000099';
const RUTA = `/mis-citas/${CITA_ID}/adelanto`;

type Pago = {
  numeroOperacion: string;
  tieneCaptura: boolean;
  registradoEn: string;
  resultado: 'CONFIRMADO' | 'RECHAZADO' | null;
  motivoRechazo: string | null;
} | null;

const adelanto = (estado: string, pago: Pago = null, cambios: object = {}) => ({
  citaId: CITA_ID,
  estado,
  montoCentimos: 400,
  precioCentimos: 2000,
  saldoCentimos: 1600,
  codigo: 'K7Q2MP',
  // 10:30 en Lima del martes 20 de octubre de 2026.
  horaLimite: '2026-10-20T10:30:00-05:00',
  limiteRevision: '2026-10-21T10:30:00-05:00',
  pago,
  devueltoEn: null,
  ...cambios,
});

const pagoRegistrado = (cambios: Partial<NonNullable<Pago>> = {}): Pago => ({
  numeroOperacion: 'OP12345678',
  tieneCaptura: false,
  registradoEn: '2026-10-20T10:05:00-05:00',
  resultado: null,
  motivoRechazo: null,
  ...cambios,
});

const CATALOGO = {
  barberia: {
    nombre: 'Barbería Huamanga',
    slug: SLUG,
    direccion: null,
    telefono: null,
    descripcion: null,
    zonaHoraria: 'America/Lima',
  },
  horario: { tramos: [] },
  servicios: [],
  barberos: [],
};

const error = (estado: number, codigo: string, mensaje: string, detalles: object[] = []) =>
  HttpResponse.json({ codigo, mensaje, detalles }, { status: estado });

interface Recibido {
  campos: Record<string, string>;
  archivo: { nombre: string; tamano: number } | null;
}

/** Lee el multipart como lo haría el servidor: los campos de texto y el nombre y tamaño del archivo. */
async function leerMultipart(request: Request): Promise<Recibido> {
  const tipo = request.headers.get('content-type') ?? '';
  const limite = tipo.split('boundary=')[1];
  const texto = Buffer.from(await request.arrayBuffer()).toString('latin1');
  const campos: Record<string, string> = {};
  let archivo: Recibido['archivo'] = null;
  for (const parte of texto.split(`--${limite}`).slice(1, -1)) {
    const [cabecera, ...resto] = parte.replace(/^\r\n/, '').split('\r\n\r\n');
    const valor = resto.join('\r\n\r\n').replace(/\r\n$/, '');
    const nombre = /name="([^"]+)"/.exec(cabecera)?.[1] as string;
    const nombreArchivo = /filename="([^"]*)"/.exec(cabecera)?.[1];
    if (nombreArchivo !== undefined) {
      archivo = { nombre: nombreArchivo, tamano: Buffer.from(valor, 'latin1').length };
    } else campos[nombre] = Buffer.from(valor, 'latin1').toString('utf8');
  }
  return { campos, archivo };
}

function servidorDelPago(inicial: ReturnType<typeof adelanto>) {
  let actual = inicial;
  const recibidos: Recibido[] = [];
  servidor.use(
    http.post('/api/v1/auth/refresh', () =>
      HttpResponse.json({
        tokenAcceso: 'token-cliente',
        tipo: 'Bearer',
        expiraEn: 900,
        usuario: {
          id: '0190a1b2-0000-7000-8000-000000000010',
          nombre: 'Luis Huamán',
          correo: 'luis@prueba.pe',
          rol: 'CLIENTE',
          barberia: BARBERIA,
        },
      }),
    ),
    http.get(`/api/v1/publico/${SLUG}`, () => HttpResponse.json(CATALOGO)),
    http.get(`/api/v1/citas/${CITA_ID}/adelanto`, () => HttpResponse.json(actual)),
    http.get(
      `/api/v1/citas/${CITA_ID}/adelanto/qr`,
      () => new HttpResponse(QR_DE_PRUEBA, { headers: { 'Content-Type': 'image/png' } }),
    ),
    http.post(`/api/v1/citas/${CITA_ID}/adelanto/pago`, async ({ request }) => {
      const recibido = await leerMultipart(request);
      recibidos.push(recibido);
      actual = adelanto(
        'POR_REVISAR',
        pagoRegistrado({
          numeroOperacion: recibido.campos.numeroOperacion.replace(/\s+/g, '').toUpperCase(),
          tieneCaptura: recibido.archivo !== null,
        }),
      );
      return HttpResponse.json(actual, { status: 201 });
    }),
  );
  return recibidos;
}

function renderizar(ruta = RUTA) {
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

const formulario = () => screen.findByRole('form', { name: 'Registrar mi pago' });

afterEach(() => {
  tokenEnMemoria.limpiar();
  vi.restoreAllMocks();
});

describe('Pagar el adelanto (/mis-citas/:citaId/adelanto)', () => {
  it('muestra el QR, el monto, el código copiable y la hora límite en texto (FR-008)', async () => {
    servidorDelPago(adelanto('POR_PAGAR'));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:qr-de-la-barberia');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    renderizar();
    expect(await screen.findByRole('heading', { level: 1, name: 'Pagar adelanto' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: 'QR de Yape o Plin de la barbería' })).toHaveAttribute(
      'src',
      'blob:qr-de-la-barberia',
    );
    const instrucciones = screen.getByRole('region', { name: 'Cómo pagar' });
    expect(instrucciones).toHaveTextContent(/S\/\s?4\.00/);
    expect(instrucciones).toHaveTextContent('K7Q2MP');
    expect(instrucciones).toHaveTextContent(/martes,? 20 de octubre/i);
    expect(instrucciones).toHaveTextContent('10:30 (hora de la barbería)');
    expect(within(instrucciones).getByText('Por pagar')).toBeInTheDocument();

    const usuario = userEvent.setup();
    await usuario.click(within(instrucciones).getByRole('button', { name: 'Copiar código' }));
    expect(await navigator.clipboard.readText()).toBe('K7Q2MP');
    expect(await screen.findByText('Código copiado')).toBeInTheDocument();
  });

  it('registra el número con una captura y pasa a "pago por revisar"', async () => {
    const recibidos = servidorDelPago(adelanto('POR_PAGAR'));
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.type(within(form).getByLabelText('Número de operación'), 'op 1234 5678');
    const captura = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])],
      'yape.png',
      {
        type: 'image/png',
      },
    );
    await usuario.upload(within(form).getByLabelText('Captura del pago (opcional)'), captura);
    await usuario.click(within(form).getByRole('button', { name: 'Registrar pago' }));

    expect(await screen.findByText(/la barbería está revisando tu pago/i)).toBeInTheDocument();
    expect(screen.getByText('OP12345678')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Registrar mi pago' })).not.toBeInTheDocument();
    expect(recibidos).toEqual([
      { campos: { numeroOperacion: 'op 1234 5678' }, archivo: { nombre: 'yape.png', tamano: 9 } },
    ]);
  });

  it('registra el número sin captura', async () => {
    const recibidos = servidorDelPago(adelanto('POR_PAGAR'));
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.type(within(form).getByLabelText('Número de operación'), 'OP99887766');
    await usuario.click(within(form).getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByText(/la barbería está revisando tu pago/i)).toBeInTheDocument();
    expect(recibidos).toEqual([{ campos: { numeroOperacion: 'OP99887766' }, archivo: null }]);
  });

  it('valida el número y la captura sin llamar al servidor', async () => {
    const recibidos = servidorDelPago(adelanto('POR_PAGAR'));
    renderizar();
    const usuario = userEvent.setup({ applyAccept: false });
    const form = await formulario();
    await usuario.type(within(form).getByLabelText('Número de operación'), '12-3');
    const grande = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
    await usuario.upload(within(form).getByLabelText('Captura del pago (opcional)'), grande);
    await usuario.click(within(form).getByRole('button', { name: 'Registrar pago' }));
    expect(
      await within(form).findByText(
        'Escribe el número de operación de tu pago (de 4 a 20 letras o dígitos).',
      ),
    ).toBeInTheDocument();
    expect(within(form).getByText('La captura pesa más de 5 MB.')).toBeInTheDocument();
    expect(within(form).getByLabelText('Número de operación')).toHaveAttribute('aria-invalid', 'true');
    expect(recibidos).toEqual([]);
  });

  it.each([
    [
      409,
      'NUMERO_OPERACION_REPETIDO',
      'Ese número de operación ya se registró en esta barbería. Revisa el número de tu pago.',
    ],
    [422, 'ADELANTO_VENCIDO', 'Pasó la hora límite para registrar el pago del adelanto.'],
    [409, 'PAGO_YA_REGISTRADO', 'Ya registraste tu pago. Espera la revisión de la barbería.'],
  ])('un %i %s muestra su mensaje y conserva el número escrito', async (estado, codigo, mensaje) => {
    servidorDelPago(adelanto('POR_PAGAR'));
    servidor.use(
      http.post(`/api/v1/citas/${CITA_ID}/adelanto/pago`, () =>
        error(estado, codigo, 'mensaje del servidor'),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.type(within(form).getByLabelText('Número de operación'), 'OP55554444');
    await usuario.click(within(form).getByRole('button', { name: 'Registrar pago' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(mensaje);
    expect(within(form).getByLabelText('Número de operación')).toHaveValue('OP55554444');
  });

  it('un 422 VALIDACION de la captura (por sus bytes) lo explica en palabras del cliente', async () => {
    servidorDelPago(adelanto('POR_PAGAR'));
    servidor.use(
      http.post(`/api/v1/citas/${CITA_ID}/adelanto/pago`, () =>
        error(422, 'VALIDACION', 'Revisa los datos del comprobante.', [
          { campo: 'archivo', problema: 'tipo_no_permitido' },
        ]),
      ),
    );
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    await usuario.type(within(form).getByLabelText('Número de operación'), 'OP55554444');
    await usuario.upload(
      within(form).getByLabelText('Captura del pago (opcional)'),
      new File([new Uint8Array([1, 2, 3])], 'captura.png', { type: 'image/png' }),
    );
    await usuario.click(within(form).getByRole('button', { name: 'Registrar pago' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'La captura debe ser una imagen JPG o PNG, o un PDF.',
    );
  });

  it('por revisar: muestra el número registrado y no ofrece otro registro', async () => {
    servidorDelPago(adelanto('POR_REVISAR', pagoRegistrado({ tieneCaptura: true })));
    renderizar();
    expect(await screen.findByText(/la barbería está revisando tu pago/i)).toBeInTheDocument();
    expect(screen.getByText('Pago por revisar')).toBeInTheDocument();
    expect(screen.getByText('OP12345678')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Registrar mi pago' })).not.toBeInTheDocument();
  });

  it('rechazado: muestra el motivo y permite registrar otro número', async () => {
    servidorDelPago(
      adelanto('POR_PAGAR', pagoRegistrado({ resultado: 'RECHAZADO', motivoRechazo: 'No aparece en Yape' })),
    );
    renderizar();
    expect(await screen.findByText(/la barbería rechazó tu pago: no aparece en yape/i)).toBeInTheDocument();
    expect(await formulario()).toBeInTheDocument();
  });

  it('confirmado: la cita quedó confirmada y se ve el saldo a pagar el día de la cita', async () => {
    servidorDelPago(adelanto('CONFIRMADO', pagoRegistrado({ resultado: 'CONFIRMADO' })));
    renderizar();
    expect(await screen.findByText(/tu adelanto está confirmado/i)).toBeInTheDocument();
    expect(screen.getByText(/saldo.*S\/\s?16\.00/i)).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Registrar mi pago' })).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'QR de Yape o Plin de la barbería' })).not.toBeInTheDocument();
  });

  it('vencido: la cita se canceló y el horario quedó libre', async () => {
    servidorDelPago(adelanto('VENCIDO'));
    renderizar();
    expect(await screen.findByText(/el plazo para pagar venció y la cita se canceló/i)).toBeInTheDocument();
    expect(screen.getByText('Vencido')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Registrar mi pago' })).not.toBeInTheDocument();
  });

  it('una cita sin adelanto (404) lo dice y ofrece volver a Mis citas', async () => {
    servidorDelPago(adelanto('POR_PAGAR'));
    servidor.use(
      http.get(`/api/v1/citas/${CITA_ID}/adelanto`, () =>
        error(404, 'NO_ENCONTRADO', 'No se encontró el recurso solicitado.'),
      ),
    );
    renderizar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se encontró el recurso solicitado.');
    expect(screen.getByRole('link', { name: 'Volver a mis citas' })).toHaveAttribute('href', '/mis-citas');
  });

  it('se usa solo con el teclado: escribir el número, saltar la captura y registrar', async () => {
    const recibidos = servidorDelPago(adelanto('POR_PAGAR'));
    renderizar();
    const usuario = userEvent.setup();
    const form = await formulario();
    const numero = within(form).getByLabelText('Número de operación');
    numero.focus();
    await usuario.keyboard('OP11223344');
    await usuario.tab();
    expect(within(form).getByLabelText('Captura del pago (opcional)')).toHaveFocus();
    await usuario.tab();
    expect(within(form).getByRole('button', { name: 'Registrar pago' })).toHaveFocus();
    await usuario.keyboard('{Enter}');
    expect(await screen.findByText(/la barbería está revisando tu pago/i)).toBeInTheDocument();
    expect(recibidos).toHaveLength(1);
  });
});

describe('Mis citas con adelanto', () => {
  const cita = (estado: string, adelantoDeCita: object | null) => ({
    id: CITA_ID,
    barberia: 'Barbería Huamanga',
    servicio: 'Corte',
    barbero: 'Luis',
    inicio: '2026-12-20T11:00:00-05:00',
    fin: '2026-12-20T11:30:00-05:00',
    precio: '20.00',
    estado,
    cancelacionTardia: false,
    cancelacionTardiaDesde: '2026-12-20T09:00:00-05:00',
    origen: 'EN_LINEA',
    confirmadaPorClienteEn: null,
    ...(adelantoDeCita ? { adelanto: adelantoDeCita } : {}),
  });

  it('una cita pendiente muestra el estado del adelanto y el enlace "Pagar adelanto", sin "Reprogramar"', async () => {
    servidorDelPago(adelanto('POR_PAGAR'));
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({
          elementos: [cita('PENDIENTE', adelanto('POR_PAGAR'))],
          total: 1,
          pagina: 1,
          tamano: 10,
        }),
      ),
    );
    renderizar('/mis-citas');
    const enlace = await screen.findByRole('link', { name: 'Pagar adelanto' });
    expect(enlace).toHaveAttribute('href', RUTA);
    expect(screen.getByText('Adelanto por pagar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reprogramar' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument();
  });

  it('una cita confirmada con adelanto muestra el adelanto confirmado y el saldo', async () => {
    servidorDelPago(adelanto('CONFIRMADO'));
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({
          elementos: [cita('CONFIRMADA', adelanto('CONFIRMADO'))],
          total: 1,
          pagina: 1,
          tamano: 10,
        }),
      ),
    );
    renderizar('/mis-citas');
    expect(await screen.findByText('Adelanto confirmado')).toBeInTheDocument();
    expect(screen.getByText(/saldo S\/\s?16\.00/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ver adelanto' })).toHaveAttribute('href', RUTA);
  });

  it('una cita sin adelanto se ve como en 002', async () => {
    servidorDelPago(adelanto('POR_PAGAR'));
    servidor.use(
      http.get('/api/v1/clientes/yo/citas', () =>
        HttpResponse.json({ elementos: [cita('CONFIRMADA', null)], total: 1, pagina: 1, tamano: 10 }),
      ),
    );
    renderizar('/mis-citas');
    expect(await screen.findByRole('button', { name: 'Reprogramar' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /adelanto/i })).not.toBeInTheDocument();
  });
});
