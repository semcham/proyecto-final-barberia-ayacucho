import { v7 as uuidv7 } from 'uuid';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarbero, sembrarPago, sembrarUsuario } from '../../helpers/fixtures';
import { type BarberiaEnPrueba, barberiaEnPrueba, PLAN_BASICO } from '../../helpers/pagos';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T047 · Plan del período vigente y plan con límites menores (FR-005, FR-005a; R04; M3). Los límites salen
// del período pagado que cubre el instante, aunque la suscripción todavía tenga registrado el plan anterior
// (la tarea programada aún no pasó). Con un plan menor que lo que la barbería usa, nada se desactiva solo:
// crear o reactivar por encima del límite se rechaza con el error de límite existente, y desactivar sigue
// permitido.

const DIA = 24 * 60 * 60 * 1000;
const seed = () => poolDe('seed');

describe('Plan del período vigente y plan menor (T047)', () => {
  let prueba: AppDePrueba;
  let b: BarberiaEnPrueba;
  const barberosDelPersonal: string[] = [];
  const barberosDelCatalogo: string[] = [];

  const con = () => ({ Authorization: `Bearer ${b.token}` });

  async function activos() {
    const { rows } = await seed().query(
      `SELECT (SELECT count(*)::int FROM membership WHERE tenant_id = $1 AND status = 'ACTIVA'
                 AND role_code IN ('PROPIETARIO', 'BARBERO')) AS personal,
              (SELECT count(*)::int FROM barber WHERE tenant_id = $1 AND active) AS barberos`,
      [b.tenantId],
    );
    return rows[0] as { personal: number; barberos: number };
  }

  beforeAll(async () => {
    prueba = await crearApp();
    b = await barberiaEnPrueba();
    // En prueba (5 y 5): el propietario más 4 barberos del personal, y 5 barberos del catálogo.
    for (let i = 0; i < 4; i += 1) {
      barberosDelPersonal.push(
        (await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' })).usuarioId,
      );
    }
    for (let i = 0; i < 5; i += 1)
      barberosDelCatalogo.push((await sembrarBarbero({ tenantId: b.tenantId })).barberoId);

    // Empieza un período del plan BÁSICO (3 y 3). La suscripción sigue registrada con el plan de prueba.
    const inicio = new Date(Date.now() - DIA);
    await seed().query(
      `UPDATE subscription SET trial_ends_at = $2, current_period_end = $3, status = 'ACTIVE' WHERE id = $1`,
      [b.suscripcionId, inicio, sumarUnMes(inicio)],
    );
    const pago = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      metodo: 'TRANSFERENCIA',
      estado: 'APROBADO',
      cubreDesde: inicio,
    });
    await seed().query(
      `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [uuidv7(), b.tenantId, b.suscripcionId, pago.pagoId, PLAN_BASICO, inicio, sumarUnMes(inicio)],
    );
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('los límites son los del plan del período vigente, no los del plan registrado', async () => {
    const { rows } = await seed().query(
      'SELECT p.code FROM subscription s JOIN plan p ON p.id = s.plan_id WHERE s.id = $1',
      [b.suscripcionId],
    );
    expect(rows[0].code).toBe('TRIAL');
    const { body } = await prueba.agente.get('/api/v1/suscripcion').set(con()).expect(200);
    expect(body.plan.codigo).toBe('BASICO');
    expect(body.limites).toEqual({ maxUsuarios: 3, maxBarberos: 3 });
  });

  it('nada se desactiva solo', async () => {
    expect(await activos()).toEqual({ personal: 5, barberos: 5 });
  });

  it('crear un usuario por encima del límite se rechaza con el error de límite existente', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/usuarios')
      .set(con())
      .send({ nombre: 'Barbero Nuevo', correo: `nuevo-${uuidv7()}@prueba.pe`, rol: 'BARBERO' });
    expect([respuesta.status, respuesta.body.codigo]).toEqual([403, 'SUSCRIPCION_NO_PERMITE']);
    expect(respuesta.body.detalles).toEqual([
      expect.objectContaining({ motivo: 'LIMITE_USUARIOS', maximo: 3 }),
    ]);
  });

  it('crear un barbero del catálogo por encima del límite se rechaza', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/barberos')
      .set(con())
      .send({ nombre: `Barbero ${uuidv7().slice(-6)}`, servicioIds: [] });
    expect([respuesta.status, respuesta.body.codigo]).toEqual([403, 'SUSCRIPCION_NO_PERMITE']);
    expect(respuesta.body.detalles).toEqual([
      expect.objectContaining({ motivo: 'LIMITE_BARBEROS', maximo: 3 }),
    ]);
  });

  it('desactivar sigue permitido, y reactivar por encima del límite se rechaza', async () => {
    const [usuario] = barberosDelPersonal;
    await prueba.agente
      .patch(`/api/v1/usuarios/${usuario}`)
      .set(con())
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    const reactivar = await prueba.agente
      .patch(`/api/v1/usuarios/${usuario}`)
      .set(con())
      .send({ estado: 'ACTIVA' });
    expect([reactivar.status, reactivar.body.codigo]).toEqual([403, 'SUSCRIPCION_NO_PERMITE']);
    expect(reactivar.body.detalles).toEqual([expect.objectContaining({ motivo: 'LIMITE_USUARIOS' })]);

    const [barbero] = barberosDelCatalogo;
    await prueba.agente.patch(`/api/v1/barberos/${barbero}`).set(con()).send({ activo: false }).expect(200);
    const reactivarBarbero = await prueba.agente
      .patch(`/api/v1/barberos/${barbero}`)
      .set(con())
      .send({ activo: true });
    expect([reactivarBarbero.status, reactivarBarbero.body.codigo]).toEqual([403, 'SUSCRIPCION_NO_PERMITE']);
    expect(reactivarBarbero.body.detalles).toEqual([expect.objectContaining({ motivo: 'LIMITE_BARBEROS' })]);
    expect(await activos()).toEqual({ personal: 4, barberos: 4 });
  });
});
