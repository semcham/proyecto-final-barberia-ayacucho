import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarBarberia } from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T018 de 011 · Servicios en lote (US1; FR-001 a FR-005, FR-010 a FR-017, FR-020, FR-021): revisión sin guardar, todo o
// nada, nombres, "falta el precio", idempotencia, suscripción vencida y auditoría.

type Fila = { nombre: string; duracionMinutos: number | null; precio: string; descripcion?: string | null };

const fila = (nombre: string, cambios: Partial<Fila> = {}): Fila => ({
  nombre,
  duracionMinutos: 30,
  precio: '25',
  ...cambios,
});

describe('Servicios en lote', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Una barbería nueva y el token de su propietario (cada prueba con la suya: los conteos no se mezclan). */
  async function barberia() {
    const b = await sembrarBarberia();
    const token = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    const como = { Authorization: `Bearer ${token}` };
    return {
      ...b,
      revisar: (filas: Fila[]) =>
        prueba.agente.post('/api/v1/servicios/lote/revision').set(como).send({ filas }),
      cargar: (filas: Fila[], clave: string = randomUUID()) =>
        prueba.agente
          .post('/api/v1/servicios/lote')
          .set({ ...como, 'Idempotency-Key': clave })
          .send({ filas }),
      crearUno: (cuerpo: object) => prueba.agente.post('/api/v1/servicios').set(como).send(cuerpo),
      editarUno: (id: string, cuerpo: object) =>
        prueba.agente.patch(`/api/v1/servicios/${id}`).set(como).send(cuerpo),
      listar: () => prueba.agente.get('/api/v1/servicios').set(como),
      contar: async () =>
        (
          await poolDe('seed').query<{ n: number }>(
            'SELECT count(*)::int AS n FROM service WHERE tenant_id = $1',
            [b.tenantId],
          )
        ).rows[0].n,
    };
  }

  it('(a) la revisión no guarda nada y devuelve los errores por fila', async () => {
    const b = await barberia();
    const { body } = await b
      .revisar([fila('Corte'), fila('M', { duracionMinutos: 7 }), fila('Barba', { precio: '' })])
      .expect(200);
    expect(body).toEqual({
      filas: 3,
      errores: [
        { fila: 2, campo: 'nombre', problema: 'longitud' },
        { fila: 2, campo: 'duracionMinutos', problema: 'multiplo_de_5' },
        { fila: 3, campo: 'precio', problema: 'falta' },
      ],
      advertencias: [],
    });
    expect(await b.contar()).toBe(0);
  });

  it('(b) guarda 10 filas válidas: 201, en la lista y en el catálogo público', async () => {
    const b = await barberia();
    const filas = Array.from({ length: 10 }, (_, i) => fila(`Servicio ${i + 1}`, { precio: `${20 + i}.5` }));
    const { body } = await b.cargar(filas).expect(201);
    expect(body).toEqual({ tipo: 'SERVICIOS', creados: 10, ids: expect.any(Array) });
    expect(body.ids).toHaveLength(10);

    const lista = (await b.listar().expect(200)).body as {
      id: string;
      nombre: string;
      precio: string;
      activo: boolean;
    }[];
    expect(lista.map((s) => s.nombre).sort()).toEqual(filas.map((f) => f.nombre).sort());
    expect(lista.every((s) => s.activo)).toBe(true);
    expect(lista.find((s) => s.nombre === 'Servicio 1')?.precio).toBe('20.50');

    const publico = await prueba.agente.get(`/api/v1/publico/${b.slug}`).expect(200);
    expect(publico.body.servicios.map((s: { nombre: string }) => s.nombre)).toEqual(
      expect.arrayContaining(['Servicio 1', 'Servicio 10']),
    );
  });

  it('(c) todo o nada: 49 válidas y 1 inválida → 400 CARGA_INVALIDA y no se crea ninguna', async () => {
    const b = await barberia();
    const filas = Array.from({ length: 50 }, (_, i) => fila(`Servicio ${i + 1}`));
    filas[37] = fila('Servicio 38', { duracionMinutos: 1000 });
    const { body } = await b.cargar(filas).expect(400);
    expect(body).toMatchObject({
      codigo: 'CARGA_INVALIDA',
      detalles: [{ fila: 38, campo: 'duracionMinutos', problema: 'rango' }],
    });
    expect(await b.contar()).toBe(0);
  });

  it('(d) un nombre creado entre la revisión y el guardado → no se crea ninguno y la fila queda marcada', async () => {
    const b = await barberia();
    const filas = [fila('Corte'), fila('Tinte')];
    expect((await b.revisar(filas).expect(200)).body.errores).toEqual([]);
    await b.crearUno({ nombre: 'tinte', precio: '40', duracionMinutos: 60 }).expect(201);
    const { body } = await b.cargar(filas).expect(400);
    expect(body).toMatchObject({
      codigo: 'CARGA_INVALIDA',
      detalles: [{ fila: 2, campo: 'nombre', problema: 'ya_existe' }],
    });
    expect(await b.contar()).toBe(1);
  });

  it('(d bis) nombres repetidos dentro de la carga o iguales a uno existente (también inactivo) son errores', async () => {
    const b = await barberia();
    const creado = await b.crearUno({ nombre: 'Lavado', precio: '10', duracionMinutos: 15 }).expect(201);
    await b.editarUno(creado.body.id, { activo: false }).expect(200);
    const { body } = await b.revisar([fila('Corte'), fila('LAVADO'), fila(' corte ')]).expect(200);
    expect(body.errores).toEqual([
      { fila: 1, campo: 'nombre', problema: 'repetido_en_carga' },
      { fila: 2, campo: 'nombre', problema: 'ya_existe' },
      { fila: 3, campo: 'nombre', problema: 'repetido_en_carga' },
    ]);
  });

  it('(e) los típicos sin precio: cada fila marcada con "falta" y nada creado', async () => {
    const b = await barberia();
    const tipicos = ['Corte', 'Barba', 'Corte y barba', 'Cejas', 'Corte para niños', 'Lavado'].map((n) =>
      fila(n, { precio: '' }),
    );
    const { body } = await b.cargar(tipicos).expect(400);
    expect(body.detalles).toEqual(
      tipicos.map((_, i) => ({ fila: i + 1, campo: 'precio', problema: 'falta' })),
    );
    expect(await b.contar()).toBe(0);
  });

  it('(f) reintento con la misma clave → 200 con el mismo resumen y sin duplicar; otra carga con esa clave → 422', async () => {
    const b = await barberia();
    const clave = randomUUID();
    const filas = [fila('Corte'), fila('Barba')];
    const primero = await b.cargar(filas, clave).expect(201);
    const segundo = await b.cargar(filas, clave).expect(200);
    expect(segundo.body).toEqual(primero.body);
    expect(await b.contar()).toBe(2);

    const otra = await b.cargar([fila('Cejas')], clave).expect(422);
    expect(otra.body.codigo).toBe('IDEMPOTENCIA_CONFLICTO');
    expect(await b.contar()).toBe(2);
  });

  it('(f bis) sin Idempotency-Key o con una que no es UUID → 400 VALIDACION', async () => {
    const b = await barberia();
    const token = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    const sinClave = await prueba.agente
      .post('/api/v1/servicios/lote')
      .set({ Authorization: `Bearer ${token}` })
      .send({ filas: [fila('Corte')] })
      .expect(400);
    expect(sinClave.body.codigo).toBe('VALIDACION');
    await b.cargar([fila('Corte')], 'no-es-uuid').expect(400);
    expect(await b.contar()).toBe(0);
  });

  it('(f ter) 0 o 51 filas → 400 VALIDACION', async () => {
    const b = await barberia();
    expect((await b.revisar([]).expect(400)).body.codigo).toBe('VALIDACION');
    const muchas = Array.from({ length: 51 }, (_, i) => fila(`S ${i}`));
    expect((await b.cargar(muchas).expect(400)).body.codigo).toBe('VALIDACION');
  });

  it('(g) suscripción vencida → 403 SUSCRIPCION_NO_PERMITE en la revisión y en el guardado, sin crear nada', async () => {
    const b = await barberia();
    await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE tenant_id = $1`, [
      b.tenantId,
    ]);
    expect((await b.revisar([fila('Corte')]).expect(403)).body.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect((await b.cargar([fila('Corte')]).expect(403)).body.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect(await b.contar()).toBe(0);
  });

  it('(h) audita la carga guardada con su cantidad; las rechazadas no dejan rastro', async () => {
    const b = await barberia();
    await b.cargar([fila('Corte', { precio: '' })]).expect(400);
    await b.cargar([fila('Corte'), fila('Barba'), fila('Cejas')]).expect(201);
    const auditoria = (await filasDe('audit_log', b.tenantId)).filter(
      (f) => f.action === 'SERVICIOS_CARGADOS_EN_LOTE',
    );
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ actor_id: b.propietarioId, result: 'PERMITIDO' });
    expect(String(auditoria[0].resource)).toMatch(/^lote:[0-9a-f-]{36};cantidad=3$/);
    expect(String(auditoria[0].resource)).not.toMatch(/Corte|Barba/);
  });

  // T046 · SC-004: 50 filas válidas se guardan (con su resumen) en menos de 3 s en el entorno local. Se imprime la
  // medición para anotarla en el quickstart.
  it('(SC-004) guarda 50 filas en menos de 3 s', async () => {
    const b = await barberia();
    const filas = Array.from({ length: 50 }, (_, i) =>
      fila(`Servicio medido ${i + 1}`, { precio: `${10 + i}.50` }),
    );
    const inicio = performance.now();
    const { body } = await b.cargar(filas).expect(201);
    const ms = Math.round(performance.now() - inicio);
    console.log(`SC-004: 50 servicios guardados en ${ms} ms`);
    expect(body.creados).toBe(50);
    expect(ms).toBeLessThan(3000);
  });
});
