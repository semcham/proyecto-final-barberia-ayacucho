import { cambiarConfiguracion, subirQr, verConfiguracion } from '../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato008 } from '../helpers/contrato';
import { png } from '../helpers/comprobantes';
import { barberiaEnPrueba } from '../helpers/pagos';
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
});
