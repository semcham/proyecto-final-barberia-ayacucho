import { CandadoPostgres, RegistroDeCorridasPostgres } from '../../../src/shared/persistence/tareas-postgres';
import { crearBaseDeDatos, type BaseDeDatos } from '../../../src/shared/persistence/database';
import { EjecutorTareas, RelojDelSistema } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T023 · Ejecutor de tareas contra PostgreSQL real (ADR-024): el candado de PostgreSQL deja correr a una sola
// réplica a la vez y se libera al terminar (también si la tarea falla), y cada corrida queda en
// scheduled_job_run escrita con el rol de la aplicación, solo con conteos.

describe('EjecutorTareas con PostgreSQL (ADR-024)', () => {
  const bases: BaseDeDatos[] = [];
  let prueba: AppDePrueba;

  /** Una "réplica": su propio pool del rol de la aplicación, como cada instancia del backend. */
  function replica(nombre: string, tarea: () => Promise<{ procesados: number; fallidos: number }>) {
    const db = crearBaseDeDatos(process.env.TEST_DB_APP_URL as string, 3);
    bases.push(db);
    const ejecutor = new EjecutorTareas({
      activas: false,
      intervaloMs: 60_000,
      replica: nombre,
      candado: new CandadoPostgres(db),
      registro: new RegistroDeCorridasPostgres(db),
      reloj: new RelojDelSistema(),
    });
    ejecutor.registrar({ nombre: 'tarea-de-prueba', ejecutar: tarea });
    return ejecutor;
  }

  async function corridas(replicas: string[]) {
    const { rows } = await poolDe('seed').query(
      `SELECT job, replica, processed, failed, error_summary, finished_at IS NOT NULL AS terminada
         FROM scheduled_job_run WHERE replica = ANY($1) ORDER BY started_at`,
      [replicas],
    );
    return rows;
  }

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await Promise.all(bases.map((db) => db.destroy()));
    await prueba.cerrar();
    await cerrarPools();
  });

  it('dos réplicas a la vez: solo una ejecuta la tarea y queda una corrida registrada', async () => {
    let ejecuciones = 0;
    const tarea = async () => {
      ejecuciones += 1;
      await new Promise((r) => setTimeout(r, 300));
      return { procesados: 2, fallidos: 0 };
    };
    const [r1, r2] = [replica('prueba-r1', tarea), replica('prueba-r2', tarea)];
    const resultados = await Promise.all([
      r1.ejecutarAhora('tarea-de-prueba'),
      r2.ejecutarAhora('tarea-de-prueba'),
    ]);
    expect(resultados.filter((r) => r.ejecutada)).toHaveLength(1);
    expect(resultados.filter((r) => !r.ejecutada)).toHaveLength(1);
    expect(ejecuciones).toBe(1);
    const filas = await corridas(['prueba-r1', 'prueba-r2']);
    expect(filas).toEqual([
      {
        job: 'tarea-de-prueba',
        replica: expect.stringMatching(/^prueba-r[12]$/),
        processed: 2,
        failed: 0,
        error_summary: null,
        terminada: true,
      },
    ]);

    // Terminada la corrida, el candado quedó libre: la otra réplica ya puede ejecutarla.
    await expect(r2.ejecutarAhora('tarea-de-prueba')).resolves.toMatchObject({ ejecutada: true });
  });

  it('una tarea que falla libera el candado y queda registrada como fallida', async () => {
    const r3 = replica('prueba-r3', async () => {
      throw new RangeError('fallo a propósito');
    });
    await expect(r3.ejecutarAhora('tarea-de-prueba')).resolves.toEqual({
      ejecutada: true,
      procesados: 0,
      fallidos: 1,
    });
    await expect(r3.ejecutarAhora('tarea-de-prueba')).resolves.toMatchObject({ ejecutada: true });
    const filas = await corridas(['prueba-r3']);
    expect(filas.map((f) => [f.failed, f.error_summary])).toEqual([
      [1, 'RangeError'],
      [1, 'RangeError'],
    ]);
  });

  it('la aplicación tiene un ejecutor sin tareas programadas en las pruebas (TAREAS_ACTIVAS=false)', () => {
    const ejecutor = prueba.app.get(EjecutorTareas);
    expect(ejecutor).toBeInstanceOf(EjecutorTareas);
  });
});
