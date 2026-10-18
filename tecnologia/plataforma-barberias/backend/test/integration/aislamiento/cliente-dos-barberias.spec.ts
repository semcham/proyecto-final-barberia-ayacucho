import type { PoolClient } from 'pg';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { type ClienteSembrado, sembrarCliente } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T079 · PR09: un cliente con membresía en las barberías A y B (ADR-020). La sesión es de UNA barbería:
// con el token de A no ve ni toca nada de B, y el slug de B en una operación de negocio no cambia nada.

async function comoApp<T>(fn: (cliente: PoolClient) => Promise<T>, tenantId: string): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

describe('PR09 · Cliente con membresía en dos barberías', () => {
  let prueba: AppDePrueba;
  let a: BarberiaParaReservar;
  let b: BarberiaParaReservar;
  let enA: ClienteSembrado;
  let enB: ClienteSembrado;
  let tokenA: string;
  let tokenB: string;
  const fecha = fechaEnDias(2);

  const reservarConA = (cuerpo: object) =>
    prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${tokenA}`, 'Idempotency-Key': nuevaClave() })
      .send(cuerpo);

  beforeAll(async () => {
    prueba = await crearApp();
    a = await barberiaParaReservar();
    b = await barberiaParaReservar();
    enA = await sembrarCliente({ tenantId: a.barberia.tenantId, nombre: 'Cliente en A' });
    enB = await sembrarCliente({
      tenantId: b.barberia.tenantId,
      usuarioId: enA.usuarioId as string,
      nombre: 'Cliente en B',
    });
    tokenA = await tokenPara(a.barberia.tenantId, enA.usuarioId as string, 'CLIENTE');
    tokenB = await tokenPara(b.barberia.tenantId, enA.usuarioId as string, 'CLIENTE');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('con el token de A no puede reservar con el servicio y el barbero de B (no existen en A) y B queda igual', async () => {
    const antes = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM appointment WHERE tenant_id = $1',
      [b.barberia.tenantId],
    );
    const { body } = await reservarConA({
      servicioId: b.servicioId,
      barberoId: b.barberoId,
      inicio: horaLima(fecha, '10:00'),
    }).expect(422);
    expect(body.codigo).toBe('RESERVA_INVALIDA');
    const despues = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM appointment WHERE tenant_id = $1',
      [b.barberia.tenantId],
    );
    expect(despues.rows[0].n).toBe(antes.rows[0].n);
  });

  it.each([['barberia'], ['slug'], ['tenantId'], ['barberiaId']])(
    'POST /citas con "%s" de B en el cuerpo → 400 (la barbería sale solo del token)',
    async (campo) => {
      await reservarConA({
        servicioId: a.servicioId,
        barberoId: a.barberoId,
        inicio: horaLima(fecha, '11:00'),
        [campo]: campo === 'tenantId' || campo === 'barberiaId' ? b.barberia.tenantId : b.barberia.slug,
      }).expect(400);
    },
  );

  it('una reserva con el token de A queda en A, con el perfil de A', async () => {
    const { body } = await reservarConA({
      servicioId: a.servicioId,
      barberoId: a.barberoId,
      inicio: horaLima(fecha, '12:00'),
    }).expect(201);
    const { rows } = await poolDe('seed').query(
      'SELECT tenant_id, customer_id FROM appointment WHERE id = $1',
      [body.id],
    );
    expect(rows[0]).toEqual({ tenant_id: a.barberia.tenantId, customer_id: enA.clienteId });
  });

  it('GET /auth/yo devuelve la barbería del token, nunca la otra', async () => {
    const yoA = await prueba.agente
      .get('/api/v1/auth/yo')
      .set({ Authorization: `Bearer ${tokenA}` })
      .expect(200);
    const yoB = await prueba.agente
      .get('/api/v1/auth/yo')
      .set({ Authorization: `Bearer ${tokenB}` })
      .expect(200);
    expect(yoA.body.barberia.id).toBe(a.barberia.tenantId);
    expect(yoB.body.barberia.id).toBe(b.barberia.tenantId);
  });

  it('a nivel de base, el perfil de A no es visible desde B ni el de B desde A', async () => {
    const vistosDesdeB = await comoApp(
      async (c) =>
        (await c.query('SELECT id FROM customer_profile WHERE user_id = $1', [enA.usuarioId])).rows,
      b.barberia.tenantId,
    );
    expect(vistosDesdeB).toEqual([{ id: enB.clienteId }]);
    const vistosDesdeA = await comoApp(
      async (c) =>
        (await c.query('SELECT id FROM customer_profile WHERE user_id = $1', [enA.usuarioId])).rows,
      a.barberia.tenantId,
    );
    expect(vistosDesdeA).toEqual([{ id: enA.clienteId }]);
  });

  it('GET /horarios con el token de A: el slug o la barbería de B en la consulta → 400; sin ellos, solo opera sobre A', async () => {
    const horarios = (consulta: string, token = tokenA) =>
      prueba.agente.get(`/api/v1/horarios?${consulta}`).set({ Authorization: `Bearer ${token}` });

    for (const campo of ['slug', 'barberia', 'tenantId']) {
      const valor = campo === 'tenantId' ? b.barberia.tenantId : b.barberia.slug;
      await horarios(`servicio=${a.servicioId}&fecha=${fecha}&${campo}=${valor}`).expect(400);
    }
    // El servicio y el barbero de B no existen en A: sin horarios, aunque en B estén libres.
    const conDatosDeB = await horarios(
      `servicio=${b.servicioId}&fecha=${fecha}&barbero=${b.barberoId}`,
    ).expect(200);
    expect(conDatosDeB.body.horas).toEqual([]);
    const enB = await horarios(`servicio=${b.servicioId}&fecha=${fecha}`, tokenB).expect(200);
    expect(enB.body.horas.length).toBeGreaterThan(0);
    // Con los datos de A, solo barberos de A.
    const enA = await horarios(`servicio=${a.servicioId}&fecha=${fecha}`).expect(200);
    const barberos = new Set(enA.body.horas.flatMap((h: { barberoIds: string[] }) => h.barberoIds));
    expect([...barberos].sort()).toEqual([a.barberoId, a.otroBarberoId].sort());
  });

  it('POST /citas/{id}/cancelar con el token de A sobre su propia cita de B → 404 y la cita de B sigue activa', async () => {
    const { body: enB } = await prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${tokenB}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: b.servicioId, barberoId: b.barberoId, inicio: horaLima(fecha, '15:00') })
      .expect(201);
    await prueba.agente
      .post(`/api/v1/citas/${enB.id}/cancelar`)
      .set({ Authorization: `Bearer ${tokenA}` })
      .expect(404);
    const { rows } = await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [enB.id]);
    expect(rows[0].status).toBe('CONFIRMADA');
    // Con el token de B sí puede cancelarla.
    await prueba.agente
      .post(`/api/v1/citas/${enB.id}/cancelar`)
      .set({ Authorization: `Bearer ${tokenB}` })
      .expect(200);
  });

  it('GET /clientes/yo/citas con el token de A devuelve solo citas de A; con el de B, solo las de B', async () => {
    const enA = await prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${tokenA}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: a.servicioId, barberoId: a.barberoId, inicio: horaLima(fecha, '16:00') })
      .expect(201);
    const enB = await prueba.agente
      .post('/api/v1/citas')
      .set({ Authorization: `Bearer ${tokenB}`, 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: b.servicioId, barberoId: b.barberoId, inicio: horaLima(fecha, '17:00') })
      .expect(201);

    const historialA = await prueba.agente
      .get('/api/v1/clientes/yo/citas?tamano=50')
      .set({ Authorization: `Bearer ${tokenA}` })
      .expect(200);
    const idsA = historialA.body.elementos.map((c: { id: string }) => c.id);
    expect(idsA).toContain(enA.body.id);
    expect(idsA).not.toContain(enB.body.id);
    expect(
      historialA.body.elementos.every((c: { barberia: string }) => c.barberia === enA.body.barberia),
    ).toBe(true);
    // El slug o el tenant de B en la consulta no cambian la barbería: 400.
    await prueba.agente
      .get(`/api/v1/clientes/yo/citas?barberia=${b.barberia.slug}`)
      .set({ Authorization: `Bearer ${tokenA}` })
      .expect(400);

    const historialB = await prueba.agente
      .get('/api/v1/clientes/yo/citas?tamano=50')
      .set({ Authorization: `Bearer ${tokenB}` })
      .expect(200);
    const idsB = historialB.body.elementos.map((c: { id: string }) => c.id);
    expect(idsB).toContain(enB.body.id);
    expect(idsB).not.toContain(enA.body.id);
  });
});
