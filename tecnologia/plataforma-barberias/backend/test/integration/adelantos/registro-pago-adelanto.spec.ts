import { createHash } from 'node:crypto';
import {
  activarAdelanto,
  archivosDeAdelanto,
  conReloj,
  eventosDe,
  filaAdelanto,
  numeroDeOperacion,
  pagosDeAdelanto,
  RelojDePrueba,
  registrarPago,
  reservar,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { jpeg, pdf, png } from '../../helpers/comprobantes';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T023 de 008 · El cliente registra el pago de su adelanto (US2-3 a US2-5; FR-009 a FR-011; PR31): con o sin
// captura queda POR_REVISAR; el número no se repite en la barbería (tampoco el de una cita cancelada) y sí vale en
// otra; un solo registro vigente, también con dos a la vez; fuera de plazo se rechaza; y una captura inválida por
// sus bytes no deja nada guardado.

const MIN = 60_000;
const CINCO_MB = 5 * 1024 * 1024;
const ISO_LIMA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?-05:00$/;

describe('Registro del pago del adelanto (T023, US2)', () => {
  const reloj = new RelojDePrueba();
  let prueba: AppDePrueba;
  const dia = fechaEnDias(3);

  beforeAll(async () => {
    prueba = await crearApp({ ajustar: conReloj(reloj) });
  });

  afterEach(() => reloj.real());

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Barbería con el adelanto activo y su propietario. */
  async function barberia() {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    return { e, propietario };
  }

  /** Un cliente nuevo con su cita pendiente a la hora dada. */
  async function citaPendiente(e: Awaited<ReturnType<typeof barberia>>['e'], hora: string) {
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, hora),
    }).expect(201);
    return { cliente, citaId: body.id as string, codigo: body.adelanto.codigo as string };
  }

  it('con captura: queda POR_REVISAR con el número normalizado y la captura privada (tipo, tamaño y SHA-256)', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '10:00');
    const captura = jpeg();
    const r = await registrarPago(prueba, cliente.token, citaId, {
      numero: ' op 1234 5678 ',
      captura,
      nombre: 'cualquiera.txt',
    }).expect(201);

    expect(r.body).toMatchObject({
      citaId,
      estado: 'POR_REVISAR',
      pago: { numeroOperacion: 'OP12345678', tieneCaptura: true, resultado: null, motivoRechazo: null },
    });
    expect(r.body.pago.registradoEn).toMatch(ISO_LIMA);
    const [pago] = await pagosDeAdelanto(citaId);
    expect(pago).toMatchObject({
      operation_number: 'OP12345678',
      registered_by: cliente.cliente.usuarioId,
      review_result: null,
    });
    const captada = (await archivosDeAdelanto(e.barberia.tenantId)).find((a) => a.id === pago.file_id);
    expect(captada).toMatchObject({
      kind: 'CAPTURA',
      content_type: 'image/jpeg',
      size_bytes: captura.length,
      sha256: createHash('sha256').update(captura).digest('hex'),
      created_by: cliente.cliente.usuarioId,
    });
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_REVISAR', resolved_at: null });
  });

  it.each([
    ['sin captura', undefined],
    ['con un PDF', pdf()],
    ['con un PNG', png()],
  ])('%s también queda POR_REVISAR', async (_caso, captura) => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '11:00');
    const r = await registrarPago(prueba, cliente.token, citaId, { captura }).expect(201);
    expect(r.body).toMatchObject({ estado: 'POR_REVISAR', pago: { tieneCaptura: captura !== undefined } });
    const [pago] = await pagosDeAdelanto(citaId);
    expect(pago.file_id === null).toBe(captura === undefined);
  });

  it('publica PagoDeAdelantoRegistrado para el propietario, sin el número ni la captura (FR-024)', async () => {
    const { e } = await barberia();
    const { cliente, citaId, codigo } = await citaPendiente(e, '12:00');
    const numero = numeroDeOperacion();
    await registrarPago(prueba, cliente.token, citaId, { numero, captura: png() }).expect(201);
    const [evento, ...otros] = await eventosDe(e.barberia.tenantId, 'PagoDeAdelantoRegistrado');
    expect(otros).toEqual([]);
    const adelanto = await filaAdelanto(citaId);
    expect(evento.payload).toEqual({
      citaId,
      servicio: 'Corte',
      inicio: horaLima(dia, '12:00'),
      zonaHoraria: 'America/Lima',
      montoCentimos: 400,
      codigo,
      limiteRevision: expect.stringMatching(ISO_LIMA),
    });
    expect(Date.parse((evento.payload as { limiteRevision: string }).limiteRevision)).toBe(
      (adelanto?.review_limit_at as Date).getTime(),
    );
    expect(JSON.stringify(evento.payload)).not.toContain(numero);
  });

  it('un número ya registrado en otra cita de la barbería → 409 NUMERO_OPERACION_REPETIDO, sin cambiar nada', async () => {
    const { e } = await barberia();
    const primera = await citaPendiente(e, '13:00');
    const segunda = await citaPendiente(e, '14:00');
    const numero = numeroDeOperacion();
    await registrarPago(prueba, primera.cliente.token, primera.citaId, { numero }).expect(201);
    const r = await registrarPago(prueba, segunda.cliente.token, segunda.citaId, {
      numero: numero.toLowerCase(),
      captura: png(),
    }).expect(409);
    expect(r.body.codigo).toBe('NUMERO_OPERACION_REPETIDO');
    expect(JSON.stringify(r.body)).not.toContain(numero);
    expect(await pagosDeAdelanto(segunda.citaId)).toEqual([]);
    expect(await filaAdelanto(segunda.citaId)).toMatchObject({ status: 'POR_PAGAR' });
    // La captura de la solicitud rechazada no quedó guardada.
    expect((await archivosDeAdelanto(e.barberia.tenantId)).filter((a) => a.kind === 'CAPTURA')).toEqual([]);
  });

  it('también se rechaza el número de una cita ya cancelada', async () => {
    const { e, propietario } = await barberia();
    const primera = await citaPendiente(e, '15:00');
    const numero = numeroDeOperacion();
    await registrarPago(prueba, primera.cliente.token, primera.citaId, { numero }).expect(201);
    await prueba.agente
      .post(`/api/v1/citas/${primera.citaId}/cancelar`)
      .set({ Authorization: `Bearer ${propietario}` })
      .expect(200);
    const segunda = await citaPendiente(e, '15:00');
    const r = await registrarPago(prueba, segunda.cliente.token, segunda.citaId, { numero }).expect(409);
    expect(r.body.codigo).toBe('NUMERO_OPERACION_REPETIDO');
  });

  it('el mismo número en OTRA barbería se acepta (la comparación es por barbería)', async () => {
    const a = await barberia();
    const b = await barberia();
    const enA = await citaPendiente(a.e, '16:00');
    const enB = await citaPendiente(b.e, '16:00');
    const numero = numeroDeOperacion();
    await registrarPago(prueba, enA.cliente.token, enA.citaId, { numero }).expect(201);
    await registrarPago(prueba, enB.cliente.token, enB.citaId, { numero }).expect(201);
  });

  it('un segundo registro mientras el primero está por revisar → 409 PAGO_YA_REGISTRADO (US2-5)', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '17:00');
    await registrarPago(prueba, cliente.token, citaId).expect(201);
    const r = await registrarPago(prueba, cliente.token, citaId).expect(409);
    expect(r.body.codigo).toBe('PAGO_YA_REGISTRADO');
    expect(await pagosDeAdelanto(citaId)).toHaveLength(1);
  });

  it('dos registros simultáneos de la misma cita → exactamente uno queda registrado', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '18:00');
    const respuestas = await Promise.all(
      Array.from({ length: 5 }, () => registrarPago(prueba, cliente.token, citaId)),
    );
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados).toEqual([201, 409, 409, 409, 409]);
    for (const r of respuestas.filter((x) => x.status === 409))
      expect(r.body.codigo).toBe('PAGO_YA_REGISTRADO');
    expect(await pagosDeAdelanto(citaId)).toHaveLength(1);
  });

  it('pasada la hora límite → 422 ADELANTO_VENCIDO, sin registrar nada', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '09:00');
    reloj.avanzar(31 * MIN);
    const r = await registrarPago(prueba, cliente.token, citaId).expect(422);
    expect(r.body.codigo).toBe('ADELANTO_VENCIDO');
    expect(await pagosDeAdelanto(citaId)).toEqual([]);
  });

  it.each([
    ['un texto renombrado a .png', Buffer.from('no es una imagen de verdad')],
    ['una firma JPEG sola', Buffer.from([0xff, 0xd8, 0xff])],
  ])('una captura que es %s → 422 VALIDACION del archivo, sin guardar nada', async (_caso, captura) => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '09:30');
    const r = await registrarPago(prueba, cliente.token, citaId, { captura, nombre: 'captura.png' }).expect(
      422,
    );
    expect(r.body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo: 'archivo' }] });
    expect(await pagosDeAdelanto(citaId)).toEqual([]);
    expect((await archivosDeAdelanto(e.barberia.tenantId)).filter((a) => a.kind === 'CAPTURA')).toEqual([]);
    expect(await filaAdelanto(citaId)).toMatchObject({ status: 'POR_PAGAR' });
  });

  it('una captura de más de 5 MB → 413, sin guardar nada', async () => {
    const { e } = await barberia();
    const { cliente, citaId } = await citaPendiente(e, '10:30');
    await registrarPago(prueba, cliente.token, citaId, { captura: png(CINCO_MB) }).expect(413);
    expect(await pagosDeAdelanto(citaId)).toEqual([]);
  });

  it.each([['123'], ['OP-1234'], ['123456789012345678901']])(
    'el número %j no tiene el formato → 422 VALIDACION del número',
    async (numero) => {
      const { e } = await barberia();
      const { cliente, citaId } = await citaPendiente(e, '11:30');
      const r = await registrarPago(prueba, cliente.token, citaId, { numero }).expect(422);
      expect(r.body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo: 'numeroOperacion' }] });
      expect(JSON.stringify(r.body)).not.toContain(numero);
    },
  );

  it('el propietario no registra pagos (403) y otro cliente no ve la cita (404)', async () => {
    const { e, propietario } = await barberia();
    const { citaId } = await citaPendiente(e, '12:30');
    await registrarPago(prueba, propietario, citaId).expect(403);
    const otro = await sesionCliente(e.barberia.tenantId);
    const r = await registrarPago(prueba, otro.token, citaId).expect(404);
    expect(r.body.codigo).toBe('NO_ENCONTRADO');
    expect(await pagosDeAdelanto(citaId)).toEqual([]);
  });
});
