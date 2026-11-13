import {
  activarAdelanto,
  cambiarConfiguracion,
  numeroDeOperacion,
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
import { sesionCliente } from '../helpers/sesiones';
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
  });
});
