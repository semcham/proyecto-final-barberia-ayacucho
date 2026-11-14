import {
  activarAdelanto,
  bandejaDeAdelantos,
  cambiarConfiguracion,
  cancelarCita,
  confirmarAdelanto,
  marcarDevuelto,
  numeroDeOperacion,
  rechazarPago,
  registrarPago,
  reservar,
  subirQr,
  verAdelanto,
  verConfiguracion,
} from '../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002, erroresDeContrato008, erroresDeEsquema008 } from '../helpers/contrato';
import { png } from '../helpers/comprobantes';
import { barberiaEnPrueba } from '../helpers/pagos';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../helpers/reservas';
import { sesionCliente, tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T013 de 008 · PR08, US1-5: las respuestas de la configuración del adelanto cumplen el esquema
// ConfiguracionAdelanto de specs/008-adelanto-reserva-qr/contracts/openapi.yaml, y sus errores el esquema Error.

describe('Contrato de 008 · Configuración del adelanto (T013)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET /barberia/adelanto sin configurar', async () => {
    const b = await barberiaEnPrueba();
    const { body } = await verConfiguracion(prueba, b.token).expect(200);
    expect(erroresDeContrato008('/barberia/adelanto', 'get', 200, body)).toEqual([]);
  });

  it('PUT /barberia/adelanto/qr y PUT /barberia/adelanto con monto fijo y con porcentaje', async () => {
    const b = await barberiaEnPrueba();
    const qr = await subirQr(prueba, b.token, png()).expect(200);
    expect(erroresDeContrato008('/barberia/adelanto/qr', 'put', 200, qr.body)).toEqual([]);

    const fijo = await cambiarConfiguracion(prueba, b.token, {
      activo: true,
      tipo: 'FIJO',
      montoCentimos: 1000,
      plazoMinutos: 30,
    }).expect(200);
    expect(erroresDeContrato008('/barberia/adelanto', 'put', 200, fijo.body)).toEqual([]);

    const porcentaje = await cambiarConfiguracion(prueba, b.token, {
      activo: true,
      tipo: 'PORCENTAJE',
      porcentaje: 20,
      plazoMinutos: 30,
    }).expect(200);
    expect(erroresDeContrato008('/barberia/adelanto', 'put', 200, porcentaje.body)).toEqual([]);

    const leida = await verConfiguracion(prueba, b.token).expect(200);
    expect(erroresDeContrato008('/barberia/adelanto', 'get', 200, leida.body)).toEqual([]);
  });

  it('los errores 422 (VALIDACION y QR_REQUERIDO) y 400 cumplen el esquema Error', async () => {
    const b = await barberiaEnPrueba();
    const sinQr = await cambiarConfiguracion(prueba, b.token, {
      activo: true,
      tipo: 'FIJO',
      montoCentimos: 1000,
      plazoMinutos: 30,
    }).expect(422);
    expect(erroresDeContrato008('/barberia/adelanto', 'put', 422, sinQr.body)).toEqual([]);

    const archivo = await subirQr(prueba, b.token, Buffer.from('texto')).expect(422);
    expect(erroresDeContrato008('/barberia/adelanto/qr', 'put', 422, archivo.body)).toEqual([]);

    const cuerpo = await cambiarConfiguracion(prueba, b.token, {
      activo: false,
      tenantId: b.tenantId,
    }).expect(400);
    expect(erroresDeContrato008('/barberia/adelanto', 'put', 400, cuerpo.body)).toEqual([]);
  });

  // T026 · Fase 3 (US2): la reserva con adelanto, el adelanto de la cita y el registro del pago.
  describe('reserva pendiente y registro del pago', () => {
    const dia = fechaEnDias(3);

    async function citaPendiente(hora: string) {
      const e = await barberiaParaReservar();
      await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
      const cliente = await sesionCliente(e.barberia.tenantId);
      const r = await reservar(prueba, cliente.token, {
        servicioId: e.servicioId,
        barberoId: e.barberoId,
        inicio: horaLima(dia, hora),
      }).expect(201);
      return { e, cliente, r };
    }

    it('POST /citas con adelanto: la Cita de 002 más el objeto Adelanto (CitaConAdelanto)', async () => {
      const { r } = await citaPendiente('10:00');
      expect(erroresDeContrato002('/citas', 'post', 201, r.body)).toEqual([]);
      expect(erroresDeEsquema008('Adelanto', r.body.adelanto)).toEqual([]);
    });

    it('GET /citas/{id}/adelanto y POST /citas/{id}/adelanto/pago responden el esquema Adelanto', async () => {
      const { cliente, r } = await citaPendiente('11:00');
      const visto = await verAdelanto(prueba, cliente.token, r.body.id).expect(200);
      expect(erroresDeContrato008('/citas/{id}/adelanto', 'get', 200, visto.body)).toEqual([]);
      const pago = await registrarPago(prueba, cliente.token, r.body.id, { captura: png() }).expect(201);
      expect(erroresDeContrato008('/citas/{id}/adelanto/pago', 'post', 201, pago.body)).toEqual([]);
      expect(pago.body.pago).not.toBeNull();
    });

    it('los errores 409 y 422 del registro del pago cumplen el esquema Error', async () => {
      const { e, cliente, r } = await citaPendiente('12:00');
      const numero = numeroDeOperacion();
      await registrarPago(prueba, cliente.token, r.body.id, { numero }).expect(201);
      const repetido = await registrarPago(prueba, cliente.token, r.body.id, { numero }).expect(409);
      expect(erroresDeContrato008('/citas/{id}/adelanto/pago', 'post', 409, repetido.body)).toEqual([]);
      const otro = await sesionCliente(e.barberia.tenantId);
      const otra = await reservar(prueba, otro.token, {
        servicioId: e.servicioId,
        barberoId: e.otroBarberoId,
        inicio: horaLima(dia, '12:00'),
      }).expect(201);
      const formato = await registrarPago(prueba, otro.token, otra.body.id, { numero: '12' }).expect(422);
      expect(erroresDeContrato008('/citas/{id}/adelanto/pago', 'post', 422, formato.body)).toEqual([]);
    });

    // T038 · Fase 4 (US3): confirmación, rechazo y bandeja.
    it('confirmación (CitaConAdelanto), rechazo (Adelanto) y bandeja (AdelantoEnBandeja), y sus errores', async () => {
      const { e, cliente, r } = await citaPendiente('13:00');
      const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
      const sinPago = await confirmarAdelanto(prueba, propietario, r.body.id).expect(409);
      expect(erroresDeContrato008('/citas/{id}/adelanto/confirmacion', 'post', 409, sinPago.body)).toEqual(
        [],
      );
      await registrarPago(prueba, cliente.token, r.body.id, { captura: png() }).expect(201);

      const bandeja = await bandejaDeAdelantos(prueba, propietario).expect(200);
      expect(bandeja.body).toHaveLength(1);
      expect(erroresDeContrato008('/adelantos/por-revisar', 'get', 200, bandeja.body)).toEqual([]);

      const motivoCorto = await rechazarPago(prueba, propietario, r.body.id, 'no').expect(422);
      expect(erroresDeContrato008('/citas/{id}/adelanto/rechazo', 'post', 422, motivoCorto.body)).toEqual([]);
      const rechazo = await rechazarPago(prueba, propietario, r.body.id, 'No aparece en Yape').expect(200);
      expect(erroresDeContrato008('/citas/{id}/adelanto/rechazo', 'post', 200, rechazo.body)).toEqual([]);

      await registrarPago(prueba, cliente.token, r.body.id).expect(201);
      const confirmada = await confirmarAdelanto(prueba, propietario, r.body.id).expect(200);
      expect(erroresDeContrato002('/citas', 'post', 201, confirmada.body)).toEqual([]);
      expect(erroresDeEsquema008('Adelanto', confirmada.body.adelanto)).toEqual([]);
      const resuelto = await rechazarPago(prueba, propietario, r.body.id, 'No aparece en Yape').expect(409);
      expect(erroresDeContrato008('/citas/{id}/adelanto/rechazo', 'post', 409, resuelto.body)).toEqual([]);
    });

    // T056 · Fase 6 (US5): marcar devuelto y la bandeja de los por devolver.
    it('devolución (Adelanto), su 409 y la bandeja con estado=POR_DEVOLVER (AdelantoEnBandeja)', async () => {
      const { e, cliente, r } = await citaPendiente('14:00');
      const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
      await registrarPago(prueba, cliente.token, r.body.id).expect(201);
      const noPorDevolver = await marcarDevuelto(prueba, propietario, r.body.id).expect(409);
      expect(
        erroresDeContrato008('/citas/{id}/adelanto/devolucion', 'post', 409, noPorDevolver.body),
      ).toEqual([]);

      // Cancelada con el pago por revisar: queda por devolver.
      await cancelarCita(prueba, cliente.token, r.body.id).expect(200);
      const bandeja = await bandejaDeAdelantos(prueba, propietario, 'POR_DEVOLVER').expect(200);
      expect(bandeja.body).toHaveLength(1);
      expect(bandeja.body[0].adelanto.estado).toBe('POR_DEVOLVER');
      expect(erroresDeContrato008('/adelantos/por-revisar', 'get', 200, bandeja.body)).toEqual([]);

      const devuelto = await marcarDevuelto(prueba, propietario, r.body.id).expect(200);
      expect(devuelto.body).toMatchObject({ estado: 'DEVUELTO', devueltoEn: expect.any(String) });
      expect(erroresDeContrato008('/citas/{id}/adelanto/devolucion', 'post', 200, devuelto.body)).toEqual([]);
      expect((await bandejaDeAdelantos(prueba, propietario, 'POR_DEVOLVER').expect(200)).body).toEqual([]);
    });
  });
});
