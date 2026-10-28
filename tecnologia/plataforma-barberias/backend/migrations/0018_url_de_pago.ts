import { type Kysely, sql } from 'kysely';

// T045 · Funcionalidad 003: URL de la página alojada del proveedor en el pago (FR-012, H3). Al repetir el
// mismo intento con la sesión todavía vigente se devuelve el mismo pago y la misma URL; sin guardarla, el
// propietario recibiría un pago sin adónde ir. Solo existe en pagos con Yape. No es un secreto (es la página
// que abre el propietario) y la plataforma no la necesita: barberias_plataforma no recibe permiso sobre ella.

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE payment
      ADD COLUMN checkout_url varchar(500) CHECK (checkout_url ~ '^https?://'),
      ADD CONSTRAINT payment_url_solo_yape CHECK (checkout_url IS NULL OR method = 'YAPE'),
      ADD CONSTRAINT payment_sesion_completa
        CHECK ((checkout_url IS NULL) = (checkout_url_expires_at IS NULL));
    GRANT UPDATE (checkout_url) ON payment TO barberias_app;
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    REVOKE UPDATE (checkout_url) ON payment FROM barberias_app;
    ALTER TABLE payment
      DROP CONSTRAINT IF EXISTS payment_sesion_completa,
      DROP CONSTRAINT IF EXISTS payment_url_solo_yape,
      DROP COLUMN IF EXISTS checkout_url;
  `,
    )
    .execute(db);
}
