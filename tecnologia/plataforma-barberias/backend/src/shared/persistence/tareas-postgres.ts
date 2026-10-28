import { sql } from 'kysely';
import { v7 as uuidv7 } from 'uuid';
import { CandadoDeTareas, RegistroDeCorridas } from '../tareas/ejecutor-tareas';
import type { BaseDeDatos } from './database';

/**
 * Candado por tarea con `pg_try_advisory_lock` (ADR-024): en una conexión propia del pool, tomada solo
 * mientras dura la corrida. Si otra réplica lo tiene, no espera: la corrida se salta. Si la réplica cae, la
 * conexión se cierra y PostgreSQL libera el candado.
 */
export class CandadoPostgres extends CandadoDeTareas {
  constructor(private readonly db: BaseDeDatos) {
    super();
  }

  async conCandado<T>(
    nombre: string,
    fn: () => Promise<T>,
  ): Promise<{ ejecutada: true; resultado: T } | { ejecutada: false }> {
    return this.db.connection().execute(async (conexion) => {
      const { rows } = await sql<{ tomado: boolean }>`
        select pg_try_advisory_lock(hashtext(${`tarea:${nombre}`})) as tomado`.execute(conexion);
      if (!rows[0]?.tomado) return { ejecutada: false as const };
      try {
        return { ejecutada: true as const, resultado: await fn() };
      } finally {
        await sql`select pg_advisory_unlock(hashtext(${`tarea:${nombre}`}))`.execute(conexion);
      }
    });
  }
}

/**
 * Corridas en `scheduled_job_run`, tabla de la plataforma (constitución 1.3.1): la escribe el rol de la
 * aplicación, sin tenant ni RLS, y solo guarda conteos.
 */
export class RegistroDeCorridasPostgres extends RegistroDeCorridas {
  constructor(private readonly db: BaseDeDatos) {
    super();
  }

  async iniciar(tarea: string, replica: string, inicio: Date): Promise<string> {
    const id = uuidv7();
    await this.db
      .insertInto('scheduled_job_run')
      .values({ id, job: tarea, replica: replica.slice(0, 32), started_at: inicio })
      .execute();
    return id;
  }

  async terminar(
    id: string,
    datos: { fin: Date; procesados: number; fallidos: number; error: string | null },
  ): Promise<void> {
    await this.db
      .updateTable('scheduled_job_run')
      .set({
        finished_at: datos.fin,
        processed: datos.procesados,
        failed: datos.fallidos,
        error_summary: datos.error,
      })
      .where('id', '=', id)
      .execute();
  }
}
