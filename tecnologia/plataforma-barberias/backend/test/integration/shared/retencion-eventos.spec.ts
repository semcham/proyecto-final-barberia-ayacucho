import { v7 as uuidv7 } from 'uuid';
import { crearInstanciaDeEventos, type InstanciaDeEventos } from '../../helpers/eventos';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T016 de 004 · Retención de la salida de eventos (research R17; decisión del responsable del 2026-11-04):
// la tarea despachar-eventos purga los eventos PROCESADO, ANULADO y SIN_MANEJADOR de más de 30 días, en
// lotes, barbería por barbería y con RLS; los PENDIENTE nunca se purgan, y no toca notification.

const DIA = "interval '1 day'";

async function sembrarEvento(
  tenantId: string,
  estado: string,
  diasDesdeElFin: number | null,
): Promise<string> {
  const id = uuidv7();
  await poolDe('seed').query(
    `INSERT INTO outbox_event (id, tenant_id, type, payload, available_at, status, attempts, created_at,
       processed_at)
     VALUES ($1, $2, 'PruebaRetencion', '{}', now() - 60 * ${DIA}, $3, 0, now() - 60 * ${DIA},
       CASE WHEN $4::int IS NULL THEN NULL ELSE now() - $4::int * ${DIA} END)`,
    [id, tenantId, estado, diasDesdeElFin],
  );
  return id;
}

async function existentes(ids: string[]): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ id: string }>(
    'SELECT id FROM outbox_event WHERE id = ANY($1)',
    [ids],
  );
  return rows.map((f) => f.id).sort();
}

describe('Retención de outbox_event (R17)', () => {
  let instancia: InstanciaDeEventos;

  beforeAll(() => {
    instancia = crearInstanciaDeEventos({ loteDePurga: 2 });
  });

  afterAll(async () => {
    await instancia.cerrar();
    await cerrarPools();
  });

  it('purga los finales de más de 30 días, en lotes y por barbería; conserva los recientes y los pendientes', async () => {
    const a = (await sembrarBarberia()).tenantId;
    const b = (await sembrarBarberia()).tenantId;
    const viejosA = [
      await sembrarEvento(a, 'PROCESADO', 31),
      await sembrarEvento(a, 'ANULADO', 40),
      await sembrarEvento(a, 'SIN_MANEJADOR', 31),
    ];
    const viejoB = await sembrarEvento(b, 'PROCESADO', 45);
    const recientes = [await sembrarEvento(a, 'PROCESADO', 29), await sembrarEvento(b, 'ANULADO', 1)];
    // Un pendiente viejo (manejador que sigue fallando) no se borra nunca.
    const pendienteViejo = await sembrarEvento(a, 'PENDIENTE', null);
    await poolDe('seed').query(
      `UPDATE outbox_event SET next_attempt_at = now() + interval '1 hour', attempts = 12 WHERE id = $1`,
      [pendienteViejo],
    );
    const avisoId = uuidv7();
    await poolDe('seed').query(
      `INSERT INTO notification (id, tenant_id, event_id, kind, recipient_kind, recipient_ref, channel_planned,
         status, discard_after, created_at)
       VALUES ($1, $2, $3, 'CITA_CREADA', 'CLIENTE', $4, 'CORREO', 'ENVIADO', now() - 50 * ${DIA},
         now() - 200 * ${DIA})`,
      [avisoId, a, viejosA[0], uuidv7()],
    );
    const todos = [...viejosA, viejoB, ...recientes, pendienteViejo];

    // Primera corrida: un lote de 2 por barbería → quedan 1 viejo de A y 0 de B.
    await instancia.despachador.ejecutar();
    const trasPrimera = await existentes(todos);
    expect(trasPrimera.filter((id) => viejosA.includes(id))).toHaveLength(1);
    expect(trasPrimera).not.toContain(viejoB);

    // Segunda corrida: termina de purgar.
    await instancia.despachador.ejecutar();
    expect(await existentes(todos)).toEqual([...recientes, pendienteViejo].sort());

    // notification no se toca (la purga los avisos M05, a los 90 días).
    const aviso = await poolDe('seed').query('SELECT 1 FROM notification WHERE id = $1', [avisoId]);
    expect(aviso.rowCount).toBe(1);
  });
});
