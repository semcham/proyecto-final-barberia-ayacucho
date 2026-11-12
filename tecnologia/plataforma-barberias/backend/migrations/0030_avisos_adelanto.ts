import { type Kysely, sql } from 'kysely';
import { TIPOS_DE_AVISO } from './0024_avisos';

// T007 · Funcionalidad 008: cinco tipos de aviso del adelanto en notification.kind (data-model.md §6 de 008;
// contracts/eventos.md §3 de 008). notification.kind es varchar(32): sin cambio de tipo; solo el CHECK.

export const TIPOS_DE_AVISO_ADELANTO = [
  'ADELANTO_SOLICITADO',
  'PAGO_ADELANTO_REGISTRADO',
  'ADELANTO_CONFIRMADO',
  'PAGO_ADELANTO_RECHAZADO',
  'ADELANTO_VENCIDO',
] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
    ALTER TABLE notification ADD CONSTRAINT notification_kind_check
      CHECK (kind IN (${lista([...TIPOS_DE_AVISO, ...TIPOS_DE_AVISO_ADELANTO])}));
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE notification DROP CONSTRAINT notification_kind_check;
    ALTER TABLE notification ADD CONSTRAINT notification_kind_check CHECK (kind IN (${lista(TIPOS_DE_AVISO)}));
  `,
    )
    .execute(db);
}
