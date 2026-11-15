import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato005 } from '../helpers/contrato';
import { sembrarCliente } from '../helpers/fixtures';
import { pedirReportes, sembrarCitaDeReporte } from '../helpers/reportes';
import { barberiaParaReservar } from '../helpers/reservas';
import { tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T017 de 005 · Las respuestas de GET /reportes cumplen el esquema ReportesDelPeriodo de
// specs/005-asistente-ia-reportes/contracts/openapi.yaml (200), y su 422 el esquema Error.

describe('Contrato de 005 · GET /reportes (T017)', () => {
  let prueba: AppDePrueba;
  let token: string;

  beforeAll(async () => {
    prueba = await crearApp();
    const e = await barberiaParaReservar();
    const { clienteId } = await sembrarCliente({ tenantId: e.barberia.tenantId });
    for (const [inicio, estado] of [
      ['2026-11-03T10:00:00-05:00', 'COMPLETADA'],
      ['2026-11-04T10:00:00-05:00', 'CANCELADA'],
      ['2026-11-05T10:00:00-05:00', 'NO_ASISTIO'],
    ] as const) {
      await sembrarCitaDeReporte({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId,
        inicio,
        estado,
        tardia: estado === 'CANCELADA',
      });
    }
    token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('200 con citas: ReportesDelPeriodo', async () => {
    const { body } = await pedirReportes(prueba, token, { desde: '2026-11-01', hasta: '2026-11-30' }).expect(
      200,
    );
    expect(erroresDeContrato005('/reportes', 'get', 200, body)).toEqual([]);
    expect(body.actividad.porDiaDeSemana).toHaveLength(7);
  });

  it('200 sin citas: ReportesDelPeriodo con las listas vacías', async () => {
    const { body } = await pedirReportes(prueba, token, { desde: '2031-01-01', hasta: '2031-01-31' }).expect(
      200,
    );
    expect(erroresDeContrato005('/reportes', 'get', 200, body)).toEqual([]);
  });

  it('422: Error con el campo a corregir', async () => {
    const { body } = await pedirReportes(prueba, token, { desde: '2026-11-30', hasta: '2026-11-01' }).expect(
      422,
    );
    expect(erroresDeContrato005('/reportes', 'get', 422, body)).toEqual([]);
  });
});
