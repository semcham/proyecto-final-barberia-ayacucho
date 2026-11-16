import { type Kysely, sql } from 'kysely';
import { ACCIONES_ACCESO_ADMIN } from './0016_plataforma';

// T032 de 007 · Indicadores de la plataforma (fase 2b, US2; FR-015; data-model §2 de 007). Cada consulta de los
// indicadores queda en platform_audit_log con la acción ADMIN_INDICADORES_CONSULTADOS: se amplía el CHECK de
// `action`. No es un permiso: no cambia ningún rol ni ninguna tabla de negocio.
//
// La lista original (0016) no se toca: esta migración agrega la acción y `down` deja el CHECK como estaba.

export const ACCIONES_ACCESO_ADMIN_007 = [...ACCIONES_ACCESO_ADMIN, 'ADMIN_INDICADORES_CONSULTADOS'] as const;

const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_log_action_check;
    ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_log_action_check
      CHECK (action IN (${lista(ACCIONES_ACCESO_ADMIN_007)}));
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    DELETE FROM platform_audit_log WHERE action = 'ADMIN_INDICADORES_CONSULTADOS';
    ALTER TABLE platform_audit_log DROP CONSTRAINT platform_audit_log_action_check;
    ALTER TABLE platform_audit_log ADD CONSTRAINT platform_audit_log_action_check
      CHECK (action IN (${lista(ACCIONES_ACCESO_ADMIN)}));
  `,
    )
    .execute(db);
}
