import { type Kysely, sql } from 'kysely';
import { MARCAS_REVISION } from './0015_pagos';

// Funcionalidad 003 (US3): marca de revisión FECHA_ANTERIOR_AL_PAGO. Un comprobante cuya fecha de transferencia
// es anterior al día en que se inició el pago (con un día de tolerancia por la hora de Lima) se acepta igual, y
// el pago queda marcado para que el administrador lo vea en la cola de comprobantes. No bloquea nada.
//
// Solo se amplía la lista de marcas válidas de payment.review: el CHECK de la columna (sin nombre propio en
// 0015, por eso PostgreSQL lo llamó payment_review_check) se reemplaza por uno con nombre. Cabe en varchar(24).

const MARCAS_CON_FECHA = [...MARCAS_REVISION, 'FECHA_ANTERIOR_AL_PAGO'] as const;
const lista = (valores: readonly string[]) => valores.map((v) => `'${v}'`).join(', ');

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql
    .raw(
      `
    ALTER TABLE payment
      DROP CONSTRAINT payment_review_check,
      ADD CONSTRAINT payment_marca_revision CHECK (review IN (${lista(MARCAS_CON_FECHA)}));
  `,
    )
    .execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  // La marca nueva no existe antes de esta migración: se quita (con su resolución) para que el CHECK anterior
  // vuelva a valer.
  await sql
    .raw(
      `
    UPDATE payment SET review = NULL, review_resolved_at = NULL, review_note = NULL
      WHERE review = 'FECHA_ANTERIOR_AL_PAGO';
    ALTER TABLE payment
      DROP CONSTRAINT IF EXISTS payment_marca_revision,
      ADD CONSTRAINT payment_review_check CHECK (review IN (${lista(MARCAS_REVISION)}));
  `,
    )
    .execute(db);
}
