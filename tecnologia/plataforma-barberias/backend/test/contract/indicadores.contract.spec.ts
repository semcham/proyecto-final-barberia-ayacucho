import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato007, erroresDeEsquema007 } from '../helpers/contrato';
import { pedirIndicadores } from '../helpers/indicadores';
import { tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T029 de 007 · GET /plataforma/indicadores cumple el esquema Indicadores de
// specs/007-indicadores-datos-personales/contracts/openapi.yaml: en la fase 2b, sin citasPorMes ni usuarios; el
// esquema también acepta el cuerpo completo de la fase 2c y rechaza datos que no son conteos.

describe('Contrato de los indicadores de la plataforma (007)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('200 cumple el esquema Indicadores (fase 2b: solo barberías)', async () => {
    const { token } = await tokenPlataformaPara();
    const respuesta = await pedirIndicadores(prueba, token).expect(200);
    expect(erroresDeContrato007('/plataforma/indicadores', 'get', 200, respuesta.body)).toEqual([]);
  });

  it('el esquema acepta el cuerpo con citasPorMes y usuarios (fase 2c) y exige números', () => {
    const completo = {
      calculadoEn: '2026-11-16T15:00:00.000Z',
      barberias: { activas: 3, suspendidas: 0, porEstadoDeSuscripcion: [{ estado: 'TRIAL', barberias: 3 }] },
      citasPorMes: [{ mes: '2026-11', total: 2, porEstado: [{ estado: 'CONFIRMADA', citas: 2 }] }],
      usuarios: { personal: 4, clientes: 9 },
    };
    expect(erroresDeEsquema007('Indicadores', completo)).toEqual([]);
    expect(
      erroresDeEsquema007('Indicadores', {
        ...completo,
        barberias: { ...completo.barberias, activas: 'tres' },
      }),
    ).not.toEqual([]);
    expect(erroresDeEsquema007('Indicadores', { barberias: completo.barberias })).not.toEqual([]);
  });
});
