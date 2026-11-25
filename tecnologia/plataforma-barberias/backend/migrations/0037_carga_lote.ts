import { type Kysely, sql } from 'kysely';
import { rlsPorTenant } from './sql-comun';

// T012 de 011 · Cargas en lote del catálogo (data-model §1; research R06). Una fila por carga GUARDADA, solo para que un
// reintento con la misma Idempotency-Key devuelva el mismo resumen sin volver a crear nada. Tabla de negocio con
// tenant_id y RLS forzada; sin nombres de servicios ni de barberos (solo su huella y los ids creados). La aplicación solo
// lee e inserta: una carga guardada no cambia. Ninguna política RLS existente cambia.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    CREATE TABLE catalog_batch (
      id               uuid         PRIMARY KEY,
      tenant_id        uuid         NOT NULL REFERENCES tenant (id),
      author_user_id   uuid         NOT NULL,
      idempotency_key  uuid         NOT NULL,
      kind             varchar(10)  NOT NULL CHECK (kind IN ('SERVICIOS', 'BARBEROS')),
      rows_digest      char(64)     NOT NULL CHECK (rows_digest ~ '^[0-9a-f]{64}$'),
      created_count    int          NOT NULL CHECK (created_count BETWEEN 1 AND 50),
      created_ids      uuid[]       NOT NULL CHECK (cardinality(created_ids) = created_count),
      created_at       timestamptz  NOT NULL DEFAULT now(),
      FOREIGN KEY (tenant_id, author_user_id) REFERENCES membership (tenant_id, user_id)
    );
    CREATE UNIQUE INDEX catalog_batch_idempotencia ON catalog_batch (tenant_id, author_user_id, idempotency_key);

    ${rlsPorTenant('catalog_batch')}

    GRANT SELECT, INSERT ON catalog_batch TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw('DROP TABLE IF EXISTS catalog_batch;').execute(db);
}
