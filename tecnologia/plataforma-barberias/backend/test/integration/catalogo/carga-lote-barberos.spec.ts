import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarBarberia, sembrarBarbero, sembrarServicio } from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T035 de 011 · Barberos en lote (US2; FR-006 a FR-009, FR-015, FR-017, FR-020): activos, sin usuario y con sus
// servicios; el cupo del plan para el lote entero; nombres repetidos como advertencia; idempotencia y auditoría. El plan
// de prueba (TRIAL) permite 5 barberos activos.

const MAXIMO_TRIAL = 5;
type Fila = { nombre: string; servicioIds?: string[] };

describe('Barberos en lote', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Barbería con `activos` barberos activos, un servicio activo y uno desactivado. */
  async function barberia(activos = 0) {
    const b = await sembrarBarberia();
    const corte = await sembrarServicio({ tenantId: b.tenantId, nombre: 'Corte' });
    const tinte = await sembrarServicio({ tenantId: b.tenantId, nombre: 'Tinte', activo: false });
    for (let i = 0; i < activos; i++)
      await sembrarBarbero({ tenantId: b.tenantId, nombre: `Existente ${i + 1}` });
    const token = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    const como = { Authorization: `Bearer ${token}` };
    return {
      ...b,
      corte: corte.servicioId,
      tinte: tinte.servicioId,
      revisar: (filas: Fila[]) =>
        prueba.agente.post('/api/v1/barberos/lote/revision').set(como).send({ filas }),
      cargar: (filas: Fila[], clave: string = randomUUID()) =>
        prueba.agente
          .post('/api/v1/barberos/lote')
          .set({ ...como, 'Idempotency-Key': clave })
          .send({ filas }),
      barberos: async () =>
        (
          await poolDe('seed').query<{
            id: string;
            display_name: string;
            user_id: string | null;
            active: boolean;
          }>(
            'SELECT id, display_name, user_id, active FROM barber WHERE tenant_id = $1 ORDER BY display_name',
            [b.tenantId],
          )
        ).rows,
    };
  }

  it('(a) dentro del cupo: activos, sin usuario y con sus servicios; visibles en la lista y en el catálogo', async () => {
    const b = await barberia(2);
    const { body } = await b
      .cargar([
        { nombre: 'Carlos Ñaupa', servicioIds: [b.corte] },
        { nombre: 'Ana Pillaca' },
        { nombre: 'Luis' },
      ])
      .expect(201);
    expect(body).toEqual({ tipo: 'BARBEROS', creados: 3, ids: expect.any(Array) });

    const nuevos = (await b.barberos()).filter((f) => body.ids.includes(f.id));
    expect(nuevos).toHaveLength(3);
    expect(nuevos.every((f) => f.active && f.user_id === null)).toBe(true);
    const { rows } = await poolDe('seed').query<{ service_id: string }>(
      'SELECT service_id FROM barber_service WHERE barber_id = ANY($1)',
      [body.ids],
    );
    expect(rows.map((r) => r.service_id)).toEqual([b.corte]);

    const publico = await prueba.agente.get(`/api/v1/publico/${b.slug}`).expect(200);
    expect(publico.body.barberos.map((x: { nombre: string }) => x.nombre)).toContain('Carlos Ñaupa');
  });

  it('(b) supera el cupo → la revisión lo dice y el guardado responde 403 LIMITE_BARBEROS sin crear ninguno', async () => {
    const b = await barberia(3);
    const filas = [{ nombre: 'Uno' }, { nombre: 'Dos' }, { nombre: 'Tres' }];
    const revision = await b.revisar(filas).expect(200);
    expect(revision.body.cupo).toEqual({ maximo: MAXIMO_TRIAL, activos: 3, disponibles: 2 });
    expect(revision.body.errores).toEqual([{ fila: null, campo: 'filas', problema: 'supera_cupo' }]);

    const r = await b.cargar(filas).expect(403);
    expect(r.body).toMatchObject({
      codigo: 'SUSCRIPCION_NO_PERMITE',
      detalles: [{ motivo: 'LIMITE_BARBEROS', maximo: MAXIMO_TRIAL, activos: 3, solicitados: 3 }],
    });
    expect(await b.barberos()).toHaveLength(3);
    // Justo el cupo sí entra.
    await b.cargar(filas.slice(0, 2)).expect(201);
    expect(await b.barberos()).toHaveLength(5);
  });

  it('(c) un nombre repetido es advertencia en la revisión y se guarda igual', async () => {
    const b = await barberia(1);
    const filas = [{ nombre: 'Existente 1' }, { nombre: 'Luis' }, { nombre: 'luis' }];
    const revision = await b.revisar(filas).expect(200);
    expect(revision.body.errores).toEqual([]);
    expect(revision.body.advertencias).toEqual([
      { fila: 1, campo: 'nombre', problema: 'ya_existe' },
      { fila: 2, campo: 'nombre', problema: 'repetido_en_carga' },
      { fila: 3, campo: 'nombre', problema: 'repetido_en_carga' },
    ]);
    await b.cargar(filas).expect(201);
    expect((await b.barberos()).filter((f) => f.display_name === 'Existente 1')).toHaveLength(2);
  });

  it('(d) servicio desactivado o de otra barbería → 400 CARGA_INVALIDA sin crear nada', async () => {
    const b = await barberia();
    const otra = await sembrarBarberia();
    const ajeno = await sembrarServicio({ tenantId: otra.tenantId, nombre: 'Ajeno' });
    const r = await b
      .cargar([
        { nombre: 'Carlos', servicioIds: [b.tinte] },
        { nombre: 'Ana', servicioIds: [ajeno.servicioId] },
        { nombre: 'C' },
      ])
      .expect(400);
    expect(r.body).toMatchObject({
      codigo: 'CARGA_INVALIDA',
      detalles: [
        { fila: 1, campo: 'servicioIds', problema: 'inactivo' },
        { fila: 2, campo: 'servicioIds', problema: 'no_existe' },
        { fila: 3, campo: 'nombre', problema: 'longitud' },
      ],
    });
    expect(await b.barberos()).toHaveLength(0);
  });

  it('(e) reintento con la misma clave → 200 y sin duplicar; la clave con otras filas → 422', async () => {
    const b = await barberia();
    const clave = randomUUID();
    const filas = [{ nombre: 'Carlos' }, { nombre: 'Ana' }];
    const primero = await b.cargar(filas, clave).expect(201);
    expect((await b.cargar(filas, clave).expect(200)).body).toEqual(primero.body);
    expect(await b.barberos()).toHaveLength(2);
    expect((await b.cargar([{ nombre: 'Otro' }], clave).expect(422)).body.codigo).toBe(
      'IDEMPOTENCIA_CONFLICTO',
    );
    // La misma clave usada para servicios no sirve para barberos (otro tipo de carga).
    const clave2 = randomUUID();
    await prueba.agente
      .post('/api/v1/servicios/lote')
      .set({
        Authorization: `Bearer ${await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO')}`,
        'Idempotency-Key': clave2,
      })
      .send({ filas: [{ nombre: 'Barba', duracionMinutos: 20, precio: '15' }] })
      .expect(201);
    expect((await b.cargar([{ nombre: 'Pedro' }], clave2).expect(422)).body.codigo).toBe(
      'IDEMPOTENCIA_CONFLICTO',
    );
  });

  it('(f) suscripción vencida → 403 en la revisión y en el guardado, sin crear nada', async () => {
    const b = await barberia();
    await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE tenant_id = $1`, [
      b.tenantId,
    ]);
    expect((await b.revisar([{ nombre: 'Carlos' }]).expect(403)).body.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect((await b.cargar([{ nombre: 'Carlos' }]).expect(403)).body.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect(await b.barberos()).toHaveLength(0);
  });

  it('(g) audita la carga con su cantidad y sin nombres', async () => {
    const b = await barberia();
    await b.cargar([{ nombre: 'Carlos' }, { nombre: 'Ana' }]).expect(201);
    const auditoria = (await filasDe('audit_log', b.tenantId)).filter(
      (f) => f.action === 'BARBEROS_CARGADOS_EN_LOTE',
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ actor_id: b.propietarioId, result: 'PERMITIDO' });
    expect(String(auditoria[0].resource)).toMatch(/^lote:[0-9a-f-]{36};cantidad=2$/);
  });

  it('(h) servicioIds que no son UUID o repetidos → 400 VALIDACION', async () => {
    const b = await barberia();
    expect((await b.revisar([{ nombre: 'Carlos', servicioIds: ['x'] }]).expect(400)).body.codigo).toBe(
      'VALIDACION',
    );
    expect(
      (await b.revisar([{ nombre: 'Carlos', servicioIds: [b.corte, b.corte] }]).expect(400)).body.codigo,
    ).toBe('VALIDACION');
  });
});
