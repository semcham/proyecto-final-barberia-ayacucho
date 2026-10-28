import { type Kysely, sql } from 'kysely';

// T020 · Funcionalidad 003: registro de las corridas del ejecutor de tareas (ADR-024, research R08).
//
// scheduled_job_run es una tabla de la plataforma (constitución 1.3.1): solo conteos, sin barbería ni datos
// de negocio. La escribe el rol de la aplicación: INSERT al empezar y UPDATE de fin y conteos al terminar.
// El UPDATE ... WHERE id = $1 exige SELECT sobre la columna del filtro, así que barberias_app recibe
// SELECT solo sobre `id` (un identificador opaco). La lee barberias_plataforma.

export const COLUMNAS_PLATAFORMA_TAREAS: Record<string, readonly string[]> = {
  scheduled_job_run: [
    'id',
    'job',
    'replica',
    'started_at',
    'finished_at',
    'processed',
    'failed',
    'error_summary',
  ],
};

export const UPDATE_APP_TAREAS = ['finished_at', 'processed', 'failed', 'error_summary'] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE scheduled_job_run (
      id             uuid PRIMARY KEY,
      job            varchar(64)  NOT NULL CHECK (job ~ '^[a-z0-9-]{3,64}$'),
      replica        varchar(32)  NOT NULL,
      started_at     timestamptz  NOT NULL,
      finished_at    timestamptz,
      processed      int          NOT NULL DEFAULT 0 CHECK (processed >= 0),
      failed         int          NOT NULL DEFAULT 0 CHECK (failed >= 0),
      error_summary  varchar(300),
      CHECK (finished_at IS NULL OR finished_at >= started_at)
    );
    CREATE INDEX scheduled_job_run_tarea ON scheduled_job_run (job, started_at DESC);

    GRANT INSERT ON scheduled_job_run TO barberias_app;
    GRANT SELECT (id) ON scheduled_job_run TO barberias_app;
    GRANT UPDATE (${UPDATE_APP_TAREAS.join(', ')}) ON scheduled_job_run TO barberias_app;
    GRANT SELECT (${COLUMNAS_PLATAFORMA_TAREAS.scheduled_job_run.join(', ')}) ON scheduled_job_run
      TO barberias_plataforma;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`DROP TABLE IF EXISTS scheduled_job_run;`).execute(db);
}
