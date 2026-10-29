import { type Kysely, sql } from 'kysely';

// Funcionalidad 003 (US5, FR-037): toda acción del administrador sobre una barbería queda en el audit_log de esa
// barbería con quién, qué barbería, qué acción, cuándo y EL MOTIVO. El motivo de suspender una barbería no tiene
// otro lugar donde quedar (tenant no lo guarda), y el de suspender la suscripción se borra de subscription al
// reactivarla: por eso va con el registro de auditoría, que no se modifica ni se borra.
//
// - Solo las acciones del administrador que llevan motivo pueden tenerlo (el resto de audit_log sigue sin texto
//   libre: nada de datos personales del propietario ni de los clientes).
// - De 5 a 300 caracteres, como los motivos del contrato (requestBodies.Motivo).
// - barberias_app ya tiene INSERT sobre la tabla completa (0001): no hace falta otro permiso.

export const ACCIONES_CON_MOTIVO = [
  'BARBERIA_SUSPENDIDA',
  'SUSCRIPCION_SUSPENDIDA',
  'ACTIVACION_MANUAL',
] as const;

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE audit_log
      ADD COLUMN reason varchar(300),
      ADD CONSTRAINT audit_log_motivo_largo
        CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 5 AND 300),
      ADD CONSTRAINT audit_log_motivo_del_administrador
        CHECK (reason IS NULL OR action IN (${ACCIONES_CON_MOTIVO.map((a) => `'${a}'`).join(', ')}));
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql.raw(`ALTER TABLE audit_log DROP COLUMN IF EXISTS reason;`).execute(db);
}
