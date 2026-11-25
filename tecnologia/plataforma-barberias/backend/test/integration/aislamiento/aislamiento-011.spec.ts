import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { type BarberiaSembrada, sembrarBarberia, sembrarServicio } from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T019 de 011 · PR09 con la carga en lote (FR-019): el tenant sale del token; una carga crea solo en su barbería, los
// nombres y las claves de otra barbería no cuentan, y el cuerpo no acepta un campo de barbería.

describe('Aislamiento 011: carga en lote', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  let tokenA: string;
  let tokenB: string;

  const cargar = (token: string, filas: object[], clave = randomUUID(), extra: object = {}) =>
    prueba.agente
      .post('/api/v1/servicios/lote')
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': clave })
      .send({ filas, ...extra });

  const nombresDe = async (tenantId: string) =>
    (
      await poolDe('seed').query<{ name: string }>(
        'SELECT name FROM service WHERE tenant_id = $1 ORDER BY name',
        [tenantId],
      )
    ).rows.map((f) => f.name);

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia();
    b = await sembrarBarberia();
    tokenA = await tokenPara(a.tenantId, a.propietarioId, 'PROPIETARIO');
    tokenB = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    await sembrarServicio({ tenantId: b.tenantId, nombre: 'Solo de B', precio: '10.00', duracionMin: 30 });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('una carga con la sesión de A crea solo en A; un nombre que existe solo en B no es "ya existe"', async () => {
    const r = await cargar(tokenA, [{ nombre: 'Solo de B', duracionMinutos: 30, precio: '15' }]).expect(201);
    expect(r.body.creados).toBe(1);
    expect(await nombresDe(a.tenantId)).toEqual(['Solo de B']);
    expect(await nombresDe(b.tenantId)).toEqual(['Solo de B']);
  });

  it('una Idempotency-Key usada en B no afecta a A', async () => {
    const clave = randomUUID();
    await cargar(tokenB, [{ nombre: 'Corte B', duracionMinutos: 30, precio: '20' }], clave).expect(201);
    const enA = await cargar(
      tokenA,
      [{ nombre: 'Corte A', duracionMinutos: 30, precio: '20' }],
      clave,
    ).expect(201);
    expect(enA.body.creados).toBe(1);
    expect(await nombresDe(a.tenantId)).toContain('Corte A');
    expect(await nombresDe(b.tenantId)).not.toContain('Corte A');
  });

  it('el cuerpo no acepta un campo de barbería: 400 y nada creado en ninguna', async () => {
    const antesA = await nombresDe(a.tenantId);
    const antesB = await nombresDe(b.tenantId);
    const r = await cargar(tokenA, [{ nombre: 'Intruso', duracionMinutos: 30, precio: '20' }], randomUUID(), {
      tenantId: b.tenantId,
    }).expect(400);
    expect(r.body.codigo).toBe('VALIDACION');
    const fila = await cargar(
      tokenA,
      [{ nombre: 'Intruso', duracionMinutos: 30, precio: '20', tenantId: b.tenantId }],
      randomUUID(),
    ).expect(400);
    expect(fila.body.codigo).toBe('VALIDACION');
    expect(await nombresDe(a.tenantId)).toEqual(antesA);
    expect(await nombresDe(b.tenantId)).toEqual(antesB);
  });

  it('la revisión de A no ve los servicios de B', async () => {
    const r = await prueba.agente
      .post('/api/v1/servicios/lote/revision')
      .set({ Authorization: `Bearer ${tokenA}` })
      .send({ filas: [{ nombre: 'Corte B', duracionMinutos: 30, precio: '20' }] })
      .expect(200);
    expect(r.body.errores).toEqual([]);
  });
});
