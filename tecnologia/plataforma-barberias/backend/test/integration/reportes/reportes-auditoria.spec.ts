import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe } from '../../helpers/fixtures';
import { pedirReportes } from '../../helpers/reportes';
import { barberiaParaReservar } from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T018 de 005 · FR-029 y research R13: cada consulta de reportes deja REPORTES_CONSULTADOS en la auditoría de la
// barbería, con el actor y el recurso `reportes:<desde>..<hasta>`, y nada más (sin cifras ni texto libre). Una consulta
// rechazada por el período no queda como consultada.

describe('T018 · Auditoría de los reportes (FR-029)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('cada consulta deja una fila REPORTES_CONSULTADOS con el actor y el período', async () => {
    const e = await barberiaParaReservar();
    const token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    await pedirReportes(prueba, token, { desde: '2026-11-01', hasta: '2026-11-30' }).expect(200);
    await pedirReportes(prueba, token, { desde: '2026-10-01', hasta: '2026-10-31' }).expect(200);

    const consultas = (await filasDe('audit_log', e.barberia.tenantId)).filter(
      (f) => f.action === 'REPORTES_CONSULTADOS',
    );
    expect(consultas).toHaveLength(2);
    expect(consultas.map((f) => f.resource).sort()).toEqual([
      'reportes:2026-10-01..2026-10-31',
      'reportes:2026-11-01..2026-11-30',
    ]);
    for (const fila of consultas) {
      expect(fila).toMatchObject({
        tenant_id: e.barberia.tenantId,
        actor_id: e.barberia.propietarioId,
        result: 'PERMITIDO',
        reason: null,
      });
    }
  });

  it('un período inválido (422) no deja REPORTES_CONSULTADOS', async () => {
    const e = await barberiaParaReservar();
    const token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    await pedirReportes(prueba, token, { desde: '2026-11-30', hasta: '2026-11-01' }).expect(422);
    const consultas = (await filasDe('audit_log', e.barberia.tenantId)).filter(
      (f) => f.action === 'REPORTES_CONSULTADOS',
    );
    expect(consultas).toEqual([]);
  });
});
