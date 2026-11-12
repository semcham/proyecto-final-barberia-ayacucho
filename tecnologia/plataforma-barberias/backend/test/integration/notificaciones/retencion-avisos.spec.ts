import { randomUUID } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { EjecutorTareas } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T066 · Retención de los avisos (research R17; principio VII). La tarea enviar-avisos purga, barbería por
// barbería y con RLS (rol de la aplicación, migración 0026), los avisos de más de 90 días en estado final
// (ENVIADO, ENVIADO_RESPALDO, FALLIDO o DESCARTADO). Los pendientes nunca se purgan. No toca outbox_event, que
// purga la tarea de despacho (T016).

const DIA_MS = 24 * 60 * 60 * 1000;

async function sembrarAviso(tenantId: string, estado: string, diasAtras: number): Promise<string> {
  const id = uuidv7();
  const creado = new Date(Date.now() - diasAtras * DIA_MS);
  await poolDe('seed').query(
    `INSERT INTO notification (id, tenant_id, event_id, kind, recipient_kind, recipient_ref, channel_planned,
       status, discard_after, created_at, next_attempt_at)
     VALUES ($1, $2, $3, 'CITA_CREADA', 'CLIENTE', $4, 'CORREO', $5, $6, $6, $7)`,
    [
      id,
      tenantId,
      randomUUID(),
      randomUUID(),
      estado,
      creado,
      // Un pendiente viejo con su próximo intento en el futuro: la tarea no lo intenta enviar en esta prueba.
      estado === 'PENDIENTE' ? new Date(Date.now() + DIA_MS) : null,
    ],
  );
  return id;
}

const idsDe = async (tenantId: string) =>
  new Set(
    (
      await poolDe('seed').query<{ id: string }>('SELECT id FROM notification WHERE tenant_id = $1', [
        tenantId,
      ])
    ).rows.map((fila) => fila.id),
  );

describe('Retención de los avisos (T066)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('purga los finales de más de 90 días, de cada barbería; deja los pendientes, los recientes y outbox_event', async () => {
    const barberias = [await sembrarBarberia(), await sembrarBarberia()];
    // Cada corrida purga hasta 100 barberías elegidas al azar (avisos-pendientes.ts). En la base compartida, los
    // archivos anteriores dejan avisos finales en muchas barberías (desde la fase 6, también los de suscripción de
    // cada vencimiento), así que con una sola corrida estas dos podrían quedar fuera. Se borran los finales de las
    // demás para que la prueba sea determinista; los archivos corren de a uno (--runInBand).
    await poolDe('seed').query(
      `DELETE FROM notification
        WHERE status IN ('ENVIADO', 'ENVIADO_RESPALDO', 'FALLIDO', 'DESCARTADO') AND NOT (tenant_id = ANY($1))`,
      [barberias.map((b) => b.tenantId)],
    );
    const purgables: string[] = [];
    const conservados: string[] = [];
    for (const { tenantId } of barberias) {
      for (const estado of ['ENVIADO', 'ENVIADO_RESPALDO', 'FALLIDO', 'DESCARTADO']) {
        purgables.push(await sembrarAviso(tenantId, estado, 91));
        conservados.push(await sembrarAviso(tenantId, estado, 89));
      }
      conservados.push(await sembrarAviso(tenantId, 'PENDIENTE', 120));
    }
    // Un evento viejo y procesado: es de la tarea de despacho, no de esta.
    const eventoId = uuidv7();
    await poolDe('seed').query(
      `INSERT INTO outbox_event (id, tenant_id, type, payload, available_at, status, created_at, processed_at)
       VALUES ($1, $2, 'CitaCreada', '{}'::jsonb, $3, 'PROCESADO', $3, $3)`,
      [eventoId, barberias[0].tenantId, new Date(Date.now() - 200 * DIA_MS)],
    );

    const corrida = await prueba.app.get(EjecutorTareas).ejecutarAhora('enviar-avisos');
    expect(corrida.ejecutada).toBe(true);

    const quedan = new Set([
      ...(await idsDe(barberias[0].tenantId)),
      ...(await idsDe(barberias[1].tenantId)),
    ]);
    expect(purgables.filter((id) => quedan.has(id))).toEqual([]);
    expect(conservados.filter((id) => !quedan.has(id))).toEqual([]);
    const evento = await poolDe('seed').query('SELECT id FROM outbox_event WHERE id = $1', [eventoId]);
    expect(evento.rows).toHaveLength(1);
  });

  it('el rol de la aplicación solo borra avisos de la barbería de su transacción (RLS)', async () => {
    const [a, b] = [await sembrarBarberia(), await sembrarBarberia()];
    const deB = await sembrarAviso(b.tenantId, 'ENVIADO', 120);
    const app = poolDe('app');
    const cliente = await app.connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query(`SELECT set_config('app.tenant_id', $1, true)`, [a.tenantId]);
      const { rowCount } = await cliente.query('DELETE FROM notification WHERE id = $1', [deB]);
      expect(rowCount).toBe(0);
      await cliente.query('COMMIT');
    } finally {
      cliente.release();
    }
    expect((await idsDe(b.tenantId)).has(deB)).toBe(true);
  });
});
