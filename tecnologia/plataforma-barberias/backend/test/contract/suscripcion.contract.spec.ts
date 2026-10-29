import { v7 as uuidv7 } from 'uuid';
import { sumarUnMes } from '../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { erroresDeContrato003 } from '../helpers/contrato';
import { sembrarPago, sembrarUsuario } from '../helpers/fixtures';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  filaDePago,
  iniciarEntornoDePagos,
  notificar,
  pagarConYape,
  PLAN_BASICO,
} from '../helpers/pagos';
import { iniciarTransferencia, png, revisar, subirComprobante } from '../helpers/comprobantes';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools, poolDe } from '../helpers/test-db';

// T033 · Contrato de las rutas de US1 (specs/003-suscripciones-pagos/contracts/openapi.yaml): cada respuesta
// se valida contra su esquema, incluidos los errores. estado-operativo, con BARBERO o CLIENTE, solo trae si la
// barbería acepta reservas y el mensaje (FR-039).

describe('Contrato de 003 · Suscripción y pago con Yape (T033)', () => {
  let entorno: EntornoDePagos;
  const planCaro = uuidv7();

  const get = (ruta: string, token: string) =>
    entorno.prueba.agente.get(`/api/v1${ruta}`).set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
    await poolDe('seed').query(
      `INSERT INTO plan (id, code, name, max_users, max_barbers, price_cents, public)
       VALUES ($1, $2, 'Plan caro del contrato', 20, 20, 70000, true)`,
      [planCaro, `CONTRATO_${planCaro.slice(-8).toUpperCase()}`],
    );
  });

  afterAll(async () => {
    await poolDe('seed').query('DELETE FROM plan WHERE id = $1', [planCaro]);
    await entorno.cerrar();
    await cerrarPools();
  });

  it('GET /planes: BÁSICO y PRO con su precio, Yape y transferencia como medios', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await get('/planes', b.token).expect(200);
    expect(erroresDeContrato003('/planes', 'get', 200, body)).toEqual([]);
    expect(body.filter((p: { codigo: string }) => ['BASICO', 'PRO'].includes(p.codigo))).toEqual([
      expect.objectContaining({
        codigo: 'BASICO',
        precioCentimos: 4900,
        mediosDisponibles: ['YAPE', 'TRANSFERENCIA'],
      }),
      expect.objectContaining({
        codigo: 'PRO',
        precioCentimos: 8900,
        mediosDisponibles: ['YAPE', 'TRANSFERENCIA'],
      }),
    ]);
    expect(body.map((p: { codigo: string }) => p.codigo)).not.toContain('TRIAL');
    // Fuera de los límites de Yape solo queda la transferencia (US3, FR-019).
    expect(body.find((p: { id: string }) => p.id === planCaro).mediosDisponibles).toEqual(['TRANSFERENCIA']);
  });

  it('GET /suscripcion en prueba, y con un pago abierto', async () => {
    const b = await barberiaEnPrueba(2);
    const enPrueba = await get('/suscripcion', b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion', 'get', 200, enPrueba.body)).toEqual([]);
    expect(enPrueba.body).toMatchObject({
      estado: 'TRIAL',
      plan: { codigo: 'TRIAL', precioCentimos: 0 },
      finPrueba: b.finPrueba.toISOString(),
      finCobertura: b.finPrueba.toISOString(),
      diasRestantes: 2,
      proximoPeriodo: null,
      limites: { maxUsuarios: 5, maxBarberos: 5 },
      pagoAbierto: null,
      avisos: ['PRUEBA_POR_TERMINAR'],
    });

    await pagarConYape(entorno.prueba, b.token).expect(201);
    const conPago = await get('/suscripcion', b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion', 'get', 200, conPago.body)).toEqual([]);
    expect(conPago.body.pagoAbierto).toMatchObject({ estado: 'PENDIENTE', medio: 'YAPE' });
  });

  it('GET /suscripcion con el período siguiente pagado muestra el próximo período', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await pagarConYape(entorno.prueba, b.token).expect(201);
    await notificar(entorno.prueba, {
      referencia: (await filaDePago(body.pago.id)).provider_reference as string,
    }).expect(200);
    const suscripcion = await get('/suscripcion', b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion', 'get', 200, suscripcion.body)).toEqual([]);
    expect(suscripcion.body).toMatchObject({
      estado: 'TRIAL',
      finCobertura: sumarUnMes(b.finPrueba).toISOString(),
      proximoPeriodo: { plan: { codigo: 'BASICO' }, iniciaEn: b.finPrueba.toISOString() },
      avisos: [],
    });
  });

  it('GET /suscripcion/estado-operativo: todo al propietario; a barbero y cliente, sin el estado (FR-039)', async () => {
    const b = await barberiaEnPrueba();
    const propietario = await get('/suscripcion/estado-operativo', b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion/estado-operativo', 'get', 200, propietario.body)).toEqual([]);
    expect(propietario.body).toEqual({
      estado: 'TRIAL',
      aceptaReservas: true,
      configuracionEditable: true,
      mensaje: null,
    });
    const barbero = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const tokens = [
      await tokenPara(b.tenantId, barbero.usuarioId, 'BARBERO'),
      (await sesionCliente(b.tenantId)).token,
    ];
    for (const token of tokens) {
      const { body } = await get('/suscripcion/estado-operativo', token).expect(200);
      expect(erroresDeContrato003('/suscripcion/estado-operativo', 'get', 200, body)).toEqual([]);
      expect(body).toEqual({ aceptaReservas: true, mensaje: null });
    }
  });

  it('POST /suscripcion/pagos: 201 y, con el mismo intento, 200 con el mismo pago', async () => {
    const b = await barberiaEnPrueba();
    const creado = await pagarConYape(entorno.prueba, b.token).expect(201);
    expect(erroresDeContrato003('/suscripcion/pagos', 'post', 201, creado.body)).toEqual([]);
    const repetido = await pagarConYape(entorno.prueba, b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion/pagos', 'post', 200, repetido.body)).toEqual([]);
    expect(repetido.body.pago.id).toBe(creado.body.pago.id);

    const pago = await get(`/suscripcion/pagos/${creado.body.pago.id}`, b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion/pagos/{pagoId}', 'get', 200, pago.body)).toEqual([]);
    const noEncontrado = await get(`/suscripcion/pagos/${uuidv7()}`, b.token).expect(404);
    expect(erroresDeContrato003('/suscripcion/pagos/{pagoId}', 'get', 404, noEncontrado.body)).toEqual([]);
  });

  it('POST /suscripcion/pagos: 409, 422 y 503 con el formato de error del contrato', async () => {
    const enRevision = await barberiaEnPrueba();
    await sembrarPago({
      tenantId: enRevision.tenantId,
      suscripcionId: enRevision.suscripcionId,
      metodo: 'TRANSFERENCIA',
      estado: 'EN_REVISION',
    });
    const conflicto = await pagarConYape(entorno.prueba, enRevision.token).expect(409);
    expect(erroresDeContrato003('/suscripcion/pagos', 'post', 409, conflicto.body)).toEqual([]);

    const b = await barberiaEnPrueba();
    const noDisponible = await pagarConYape(entorno.prueba, b.token, planCaro).expect(422);
    expect(erroresDeContrato003('/suscripcion/pagos', 'post', 422, noDisponible.body)).toEqual([]);

    await entorno.simulador.cambiarModo({ modo: 'caido' });
    try {
      const caido = await pagarConYape(entorno.prueba, b.token, PLAN_BASICO).expect(503);
      expect(erroresDeContrato003('/suscripcion/pagos', 'post', 503, caido.body)).toEqual([]);
    } finally {
      await entorno.simulador.cambiarModo({ modo: 'normal' });
    }
  });

  // US4: el historial del propietario y la lista de pagos por revisar, contra el contrato.
  it('GET /suscripcion/pagos y GET /plataforma/pagos/por-revisar según el contrato', async () => {
    const b = await barberiaEnPrueba();
    const { pagoId } = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      estado: 'APROBADO',
    });
    await poolDe('seed').query(`UPDATE payment SET review = 'DUPLICADO' WHERE id = $1`, [pagoId]);
    await pagarConYape(entorno.prueba, b.token);
    const historial = await get('/suscripcion/pagos?pagina=1', b.token).expect(200);
    expect(erroresDeContrato003('/suscripcion/pagos', 'get', 200, historial.body)).toEqual([]);
    expect(historial.body.total).toBeGreaterThanOrEqual(1);

    const { token } = await tokenPlataformaPara();
    const porRevisar = await get('/plataforma/pagos/por-revisar', token).expect(200);
    expect(erroresDeContrato003('/plataforma/pagos/por-revisar', 'get', 200, porRevisar.body)).toEqual([]);
    expect(porRevisar.body.some((c: { pagoId: string }) => c.pagoId === pagoId)).toBe(true);
  });

  // US3: la transferencia, el comprobante y la revisión del administrador, contra el mismo contrato.
  it('transferencia, comprobante y revisión: cada respuesta según el contrato', async () => {
    const b = await barberiaEnPrueba();
    const iniciado = await iniciarTransferencia(entorno.prueba, b.token).expect(201);
    expect(erroresDeContrato003('/suscripcion/pagos', 'post', 201, iniciado.body)).toEqual([]);
    const pagoId = iniciado.body.pago.id as string;
    const ruta = '/suscripcion/pagos/{pagoId}/comprobante';

    const invalido = await subirComprobante(entorno.prueba, b.token, pagoId, {
      archivo: Buffer.from('texto'),
    }).expect(400);
    expect(erroresDeContrato003(ruta, 'post', 400, invalido.body)).toEqual([]);
    const subido = await subirComprobante(entorno.prueba, b.token, pagoId, { archivo: png() }).expect(201);
    expect(erroresDeContrato003(ruta, 'post', 201, subido.body)).toEqual([]);
    const otro = await subirComprobante(entorno.prueba, b.token, pagoId, { archivo: png() }).expect(409);
    expect(erroresDeContrato003(ruta, 'post', 409, otro.body)).toEqual([]);
    const ajeno = await get(`/suscripcion/pagos/${uuidv7()}/comprobante`, b.token).expect(404);
    expect(erroresDeContrato003(ruta, 'get', 404, ajeno.body)).toEqual([]);

    const { token } = await tokenPlataformaPara();
    const cola = await get('/plataforma/comprobantes', token).expect(200);
    expect(erroresDeContrato003('/plataforma/comprobantes', 'get', 200, cola.body)).toEqual([]);
    const detalle = await get(`/plataforma/barberias/${b.tenantId}/pagos/${pagoId}`, token).expect(200);
    expect(
      erroresDeContrato003('/plataforma/barberias/{barberiaId}/pagos/{pagoId}', 'get', 200, detalle.body),
    ).toEqual([]);
    const revisado = await revisar(entorno.prueba, token, b.tenantId, pagoId, {
      resultado: 'RECHAZADO',
      motivo: 'No se ve el número de operación',
    }).expect(200);
    expect(
      erroresDeContrato003(
        '/plataforma/barberias/{barberiaId}/pagos/{pagoId}/revision',
        'post',
        200,
        revisado.body,
      ),
    ).toEqual([]);
  });
});
