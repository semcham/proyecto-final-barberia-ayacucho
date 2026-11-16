import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato007, erroresDeEsquema007 } from '../helpers/contrato';
import { sembrarBarberia, sembrarCliente } from '../helpers/fixtures';
import { sesionCliente, tokenPara } from '../helpers/sesiones';
import {
  bandeja,
  cerrarSolicitud,
  iniciarAtencion,
  misSolicitudes,
  registrarEnNombre,
  registrarSolicitud,
} from '../helpers/solicitudes-datos';
import { cerrarPools } from '../helpers/test-db';

// T005 de 007 · Las respuestas de las rutas de solicitudes cumplen specs/007-indicadores-datos-personales/contracts/
// openapi.yaml: 201 y 200 con sus esquemas, 409 con detalles[0].solicitudId, y 400 (DTO) y 422 (dominio) con el
// formato único { codigo, mensaje, detalles }.

const RUTA = '/datos-personales/solicitudes';

describe('Contrato de las solicitudes sobre datos personales (007)', () => {
  let prueba: AppDePrueba;
  let propietario: string;
  let cliente: string;
  let presencialId: string;

  beforeAll(async () => {
    prueba = await crearApp();
    const b = await sembrarBarberia();
    propietario = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    cliente = (await sesionCliente(b.tenantId)).token;
    presencialId = (
      await sembrarCliente({ tenantId: b.tenantId, conCuenta: false, creadoPor: b.propietarioId })
    ).clienteId;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('201, 409, 200 (mías, bandeja, atención y cierre) cumplen sus esquemas', async () => {
    const registrada = await registrarSolicitud(prueba, cliente, { tipo: 'ACCESO' }).expect(201);
    expect(erroresDeContrato007(RUTA, 'post', 201, registrada.body)).toEqual([]);

    const repetida = await registrarSolicitud(prueba, cliente, { tipo: 'ACCESO' }).expect(409);
    expect(erroresDeContrato007(RUTA, 'post', 409, repetida.body)).toEqual([]);
    expect(repetida.body.detalles[0].solicitudId).toBe(registrada.body.id);

    const mias = await misSolicitudes(prueba, cliente).expect(200);
    expect(erroresDeContrato007(`${RUTA}/mias`, 'get', 200, mias.body)).toEqual([]);

    const enNombre = await registrarEnNombre(prueba, propietario, {
      tipo: 'ELIMINACION',
      clienteId: presencialId,
    }).expect(201);
    expect(erroresDeContrato007(`${RUTA}/en-nombre`, 'post', 201, enNombre.body)).toEqual([]);

    const lista = await bandeja(prueba, propietario).expect(200);
    expect(lista.body).toHaveLength(2);
    expect(erroresDeContrato007(RUTA, 'get', 200, lista.body)).toEqual([]);

    const enAtencion = await iniciarAtencion(prueba, propietario, registrada.body.id).expect(200);
    expect(erroresDeContrato007(`${RUTA}/{id}/atencion`, 'post', 200, enAtencion.body)).toEqual([]);

    const cerrada = await cerrarSolicitud(prueba, propietario, registrada.body.id, {
      resultado: 'ATENDIDA',
      respuesta: 'Te enviamos tus datos.',
    }).expect(200);
    expect(erroresDeContrato007(`${RUTA}/{id}/cierre`, 'post', 200, cerrada.body)).toEqual([]);
  });

  it('400 del DTO y 422 del dominio usan el formato único de error', async () => {
    const dto = await registrarSolicitud(prueba, cliente, { tipo: 'OPOSICION' }).expect(400);
    expect(erroresDeEsquema007('Error', dto.body)).toEqual([]);
    expect(dto.body.codigo).toBe('VALIDACION');

    const dominio = await registrarSolicitud(prueba, cliente, { tipo: 'RECTIFICACION' }).expect(422);
    expect(erroresDeEsquema007('Error', dominio.body)).toEqual([]);
    expect(dominio.body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo: 'detalle' }] });
  });
});
