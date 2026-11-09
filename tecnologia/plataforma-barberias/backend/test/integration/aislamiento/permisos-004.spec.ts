import { cerrarPools, poolDe } from '../../helpers/test-db';

// T012 de 004 · Los permisos de barberias_app sobre las tablas y columnas nuevas son exactamente los de
// data-model.md §7 (constitución 1.4.1, principio III). Sin DELETE, salvo en action_link_attempt (tabla
// técnica, purga a las 24 h) y en outbox_event (purga de retención con RLS, decisión del responsable del
// 2026-11-06). La lista se escribe aquí a mano, desde el modelo de datos, y no se importa de las migraciones.

interface PermisosEsperados {
  tabla: readonly string[];
  update: readonly string[];
}

const ESPERADOS: Record<string, PermisosEsperados> = {
  appointment_reschedule: { tabla: ['SELECT', 'INSERT'], update: [] },
  appointment_link_use: { tabla: ['SELECT', 'INSERT'], update: [] },
  customer_notification_preference: {
    tabla: ['SELECT', 'INSERT'],
    update: ['channel', 'whatsapp_number', 'updated_at'],
  },
  whatsapp_consent: { tabla: ['SELECT', 'INSERT'], update: ['withdrawn_at'] },
  outbox_event: {
    tabla: ['SELECT', 'INSERT', 'DELETE'],
    update: ['status', 'attempts', 'next_attempt_at', 'processed_at'],
  },
  notification: {
    tabla: ['SELECT', 'INSERT'],
    update: [
      'channel_used',
      'status',
      'attempts',
      'next_attempt_at',
      'claimed_until',
      'sent_at',
      'last_error',
    ],
  },
  action_link_attempt: { tabla: ['SELECT', 'INSERT', 'DELETE'], update: [] },
};

/** appointment (de 0011) gana UPDATE por columna para reprogramar (data-model §1.1); lo de 0011 sigue. */
const UPDATE_APPOINTMENT = [
  'status',
  'late_cancellation',
  'cancelled_by',
  'cancelled_at',
  'cancel_reason',
  'updated_at',
  'barber_id',
  'starts_at',
  'ends_at',
  'version',
  'client_confirmed_at',
];

async function privilegiosDeTabla(tabla: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ privilegio: string }>(
    `SELECT privilege_type AS privilegio FROM information_schema.table_privileges
      WHERE grantee = 'barberias_app' AND table_schema = 'public' AND table_name = $1`,
    [tabla],
  );
  return rows.map((f) => f.privilegio).sort();
}

/** Columnas con UPDATE propio (sin las que lo heredan de un UPDATE de tabla completa, que no debe haber). */
async function columnasConUpdate(tabla: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ columna: string }>(
    `SELECT a.attname AS columna
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1 AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('barberias_app', c.oid, a.attnum, 'UPDATE')`,
    [tabla],
  );
  return rows.map((f) => f.columna).sort();
}

describe('PR09 · Permisos de barberias_app sobre las tablas de 004 (data-model §7)', () => {
  afterAll(cerrarPools);

  it.each(Object.entries(ESPERADOS))(
    '%s: exactamente los privilegios de tabla y el UPDATE por columna previstos',
    async (tabla, { tabla: privilegios, update }) => {
      expect(await privilegiosDeTabla(tabla)).toEqual([...privilegios].sort());
      expect(await columnasConUpdate(tabla)).toEqual([...update].sort());
    },
  );

  it('appointment: SELECT e INSERT, sin DELETE, y UPDATE solo de las columnas de 0011 y de reprogramar', async () => {
    expect(await privilegiosDeTabla('appointment')).toEqual(['INSERT', 'SELECT']);
    expect(await columnasConUpdate('appointment')).toEqual([...UPDATE_APPOINTMENT].sort());
  });

  it('action_link_attempt: puede insertar con su secuencia', async () => {
    const { rows } = await poolDe('seed').query<{ uso: boolean }>(
      `SELECT has_sequence_privilege('barberias_app', 'action_link_attempt_id_seq', 'USAGE') AS uso`,
    );
    expect(rows[0].uso).toBe(true);
  });

  it('ninguna tabla nueva da TRUNCATE, REFERENCES ni TRIGGER a la aplicación', async () => {
    const { rows } = await poolDe('seed').query(
      `SELECT table_name, privilege_type FROM information_schema.table_privileges
        WHERE grantee = 'barberias_app' AND table_name = ANY($1)
          AND privilege_type IN ('TRUNCATE', 'REFERENCES', 'TRIGGER')`,
      [Object.keys(ESPERADOS)],
    );
    expect(rows).toEqual([]);
  });
});
