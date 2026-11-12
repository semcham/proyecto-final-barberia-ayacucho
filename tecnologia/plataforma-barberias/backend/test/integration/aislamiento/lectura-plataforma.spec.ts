import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { COLUMNAS_PLATAFORMA, PERMISOS_APP_PLATAFORMA } from '../../../migrations/0016_plataforma';
import { COLUMNAS_PLATAFORMA_TAREAS, UPDATE_APP_TAREAS } from '../../../migrations/0017_tareas';
import { COLUMNAS_PLATAFORMA_EVENTOS } from '../../../migrations/0021_salida_de_eventos';
import { COLUMNAS_PLATAFORMA_AVISOS } from '../../../migrations/0024_avisos';
import { COLUMNAS_PLATAFORMA_ADELANTOS } from '../../../migrations/0029_adelantos';
import { LecturaPlataforma } from '../../../src/shared/lectura-plataforma';
import {
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarFilas008,
  sembrarPago,
  sembrarServicio,
  sembrarSuscripcion,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T012 · PR09 de la lectura de la plataforma (ADR-031, constitución 1.3.1, data-model.md §4):
//   1. permisos exactos de barberias_plataforma: solo SELECT por columna, lista cerrada;
//   2. rol sin privilegios extra (sin BYPASSRLS, sin objetos propios, sin las funciones de ADR-015);
//   3. lo que no puede leer falla en PostgreSQL (citas, clientes, catálogo, usuarios, sesiones de barbería,
//      contenido de comprobantes y número de operación completo);
//   4. ninguna escritura en ninguna tabla, y LecturaPlataforma abre siempre transacciones READ ONLY;
//   5. sí lee entre barberías lo que le corresponde (con el último tramo y el hash del número);
//   6. permisos de barberias_app sobre las tablas de la plataforma: solo INSERT en provider_event, nada en
//      platform_admin, y lo justo en sesiones, desafíos, auditoría del acceso y corridas de tareas.

const DIA_MS = 24 * 60 * 60 * 1000;
const PERMISOS_ESPERADOS: Record<string, readonly string[]> = {
  ...COLUMNAS_PLATAFORMA,
  ...COLUMNAS_PLATAFORMA_TAREAS,
  // 004 (ADR-025): solo las cinco columnas técnicas de la salida de eventos y de los avisos.
  ...COLUMNAS_PLATAFORMA_EVENTOS,
  ...COLUMNAS_PLATAFORMA_AVISOS,
  // 008 (research R09): las cinco columnas técnicas de booking_deposit, para la tarea vencer-adelantos.
  ...COLUMNAS_PLATAFORMA_ADELANTOS,
};

/** Tablas nuevas de 008 que barberias_plataforma no lee en absoluto (data-model §7 de 008). */
const TABLAS_008_SIN_LECTURA_DE_PLATAFORMA = [
  'booking_deposit_settings',
  'booking_deposit_file',
  'booking_deposit_payment',
];

/** Tablas nuevas de 004 que barberias_plataforma no lee en absoluto (data-model §7). */
const TABLAS_004_SIN_LECTURA_DE_PLATAFORMA = [
  'customer_notification_preference',
  'whatsapp_consent',
  'appointment_reschedule',
  'appointment_link_use',
  'action_link_attempt',
];
const TABLAS_004 = ['outbox_event', 'notification', ...TABLAS_004_SIN_LECTURA_DE_PLATAFORMA];

async function como<T>(
  rol: 'plataforma' | 'app',
  tenantId: string | null,
  fn: (c: PoolClient) => Promise<T>,
): Promise<T> {
  const cliente = await poolDe(rol).connect();
  try {
    await cliente.query('BEGIN');
    if (tenantId) await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

const comoPlataforma = <T>(fn: (c: PoolClient) => Promise<T>) => como('plataforma', null, fn);

/** Servicio, barbero y cliente con cuenta, para sembrar una cita con adelanto (008). */
async function sembrarAgenda(tenantId: string) {
  const { servicioId } = await sembrarServicio({ tenantId });
  const { barberoId } = await sembrarBarbero({ tenantId, servicios: [servicioId] });
  const { clienteId, usuarioId } = await sembrarCliente({ tenantId });
  return { servicioId, barberoId, clienteId, usuarioClienteId: usuarioId as string };
}

describe('PR09 · Lectura de la plataforma (ADR-031, constitución 1.3.1)', () => {
  const tenants: { tenantId: string; suscripcionId: string; pagoId: string; numero: string }[] = [];
  let lectura: LecturaPlataforma;

  beforeAll(async () => {
    for (const numero of ['OPA12345678', 'OPB87654321']) {
      const { tenantId } = await sembrarBarberia();
      const { suscripcionId } = await sembrarSuscripcion({
        tenantId,
        trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
      });
      const { pagoId } = await sembrarPago({
        tenantId,
        suscripcionId,
        metodo: 'TRANSFERENCIA',
        estado: 'EN_REVISION',
        numeroOperacion: numero,
      });
      tenants.push({ tenantId, suscripcionId, pagoId, numero });
    }
    lectura = LecturaPlataforma.conectar(process.env.TEST_DB_PLATAFORMA_URL as string, 2);
  });

  afterAll(async () => {
    await lectura.cerrar();
    await cerrarPools();
  });

  describe('1. Permisos exactos de barberias_plataforma', () => {
    it('solo SELECT sobre las columnas de la lista cerrada, sin ningún permiso de tabla completa', async () => {
      const seed = poolDe('seed');
      const columnas = await seed.query<{ tabla: string; columna: string; privilegio: string }>(
        `SELECT table_name AS tabla, column_name AS columna, privilege_type AS privilegio
           FROM information_schema.column_privileges
          WHERE grantee = 'barberias_plataforma' AND table_schema = 'public'`,
      );
      expect(new Set(columnas.rows.map((f) => f.privilegio))).toEqual(new Set(['SELECT']));
      const otorgadas = columnas.rows.map((f) => `${f.tabla}.${f.columna}`).sort();
      const esperadas = Object.entries(PERMISOS_ESPERADOS)
        .flatMap(([tabla, cols]) => cols.map((c) => `${tabla}.${c}`))
        .sort();
      expect(otorgadas).toEqual(esperadas);

      const tablas = await seed.query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'barberias_plataforma' AND table_schema = 'public'`,
      );
      expect(tablas.rows).toEqual([]);
    });

    it('no recibe ningún permiso sobre el contenido de los comprobantes ni sobre el número completo', () => {
      expect(Object.keys(PERMISOS_ESPERADOS)).not.toContain('payment_receipt_file');
      expect(Object.keys(PERMISOS_ESPERADOS)).not.toContain('receipt_upload_counter');
      expect(PERMISOS_ESPERADOS.payment).not.toContain('bank_operation_number');
      expect(PERMISOS_ESPERADOS.payment).toEqual(
        expect.arrayContaining(['bank_operation_last4', 'bank_operation_hash']),
      );
    });
  });

  describe('2. Rol sin privilegios extra', () => {
    it('NOBYPASSRLS, NOINHERIT, no es dueño de nada y no puede ejecutar las funciones de ADR-015', async () => {
      const seed = poolDe('seed');
      const rol = await seed.query(
        `SELECT rolbypassrls, rolsuper, rolinherit, rolcreaterole, rolcreatedb
           FROM pg_roles WHERE rolname = 'barberias_plataforma'`,
      );
      expect(rol.rows).toEqual([
        { rolbypassrls: false, rolsuper: false, rolinherit: false, rolcreaterole: false, rolcreatedb: false },
      ]);
      const miembroDe = await seed.query(
        `SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.member
          WHERE r.rolname = 'barberias_plataforma'`,
      );
      expect(miembroDe.rows).toEqual([]);

      const propios = await seed.query(
        `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
          WHERE r.rolname = 'barberias_plataforma'
         UNION ALL
         SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE r.rolname = 'barberias_plataforma'`,
      );
      expect(propios.rows).toEqual([]);

      const funciones = await seed.query<{ proname: string; ejecuta: boolean }>(
        `SELECT p.proname, has_function_privilege('barberias_plataforma', p.oid, 'EXECUTE') AS ejecuta
           FROM pg_proc p
          WHERE p.proname IN ('auth_resolver_cuenta', 'auth_buscar_sesion', 'auth_buscar_activacion')
          ORDER BY p.proname`,
      );
      expect(funciones.rows).toEqual([
        { proname: 'auth_buscar_activacion', ejecuta: false },
        { proname: 'auth_buscar_sesion', ejecuta: false },
        { proname: 'auth_resolver_cuenta', ejecuta: false },
      ]);
      await expect(
        comoPlataforma((c) => c.query("SELECT * FROM auth_resolver_cuenta('x@prueba.pe')")),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('3. Lo que no puede leer falla en PostgreSQL', () => {
    it.each([
      ['SELECT id FROM appointment'],
      ['SELECT id FROM customer_profile'],
      ['SELECT id FROM service'],
      ['SELECT id FROM barber'],
      ['SELECT id FROM time_off'],
      ['SELECT id FROM membership'],
      ['SELECT id FROM user_account'],
      ['SELECT id FROM auth_session'],
      ['SELECT id FROM audit_log'],
      ['SELECT id FROM account_activation'],
      ['SELECT content FROM payment_receipt_file'],
      ['SELECT tenant_id FROM payment_receipt_file'],
      ['SELECT count FROM receipt_upload_counter'],
      ['SELECT bank_operation_number FROM payment'],
      ['SELECT * FROM payment'],
      ['SELECT phone FROM tenant'],
      ['SELECT * FROM tenant'],
    ])('%s → permiso denegado', async (consulta) => {
      await expect(comoPlataforma((c) => c.query(consulta))).rejects.toThrow(/permission denied/);
    });
  });

  describe('4. Ninguna escritura', () => {
    it('no tiene INSERT, UPDATE, DELETE, TRUNCATE ni REFERENCES sobre ninguna tabla del esquema', async () => {
      const { rows } = await poolDe('seed').query<{ tabla: string; privilegio: string }>(
        `SELECT c.relname AS tabla, p.privilegio
           FROM pg_class c
           JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN unnest(ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) AS p(privilegio)
          WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm')
            AND (has_table_privilege('barberias_plataforma', c.oid, p.privilegio)
                 OR (p.privilegio IN ('INSERT', 'UPDATE', 'REFERENCES')
                     AND has_any_column_privilege('barberias_plataforma', c.oid, p.privilegio)))`,
      );
      expect(rows).toEqual([]);
    });

    it.each([
      [`UPDATE payment SET status = 'APROBADO'`],
      [`UPDATE subscription SET status = 'ACTIVE'`],
      [`DELETE FROM subscription_period`],
      [`UPDATE tenant SET status = 'SUSPENDIDA'`],
      [
        `INSERT INTO provider_event (event_id, provider_reference, reported_status, effect)
         VALUES ('evt_x', 'ses_x', 'APROBADO', 'SIN_PAGO')`,
      ],
      [
        `INSERT INTO platform_audit_log (id, action, result) VALUES (gen_random_uuid(), 'ADMIN_INGRESO', 'PERMITIDO')`,
      ],
      [`UPDATE platform_session SET status = 'REVOCADA'`],
      [`UPDATE platform_admin SET status = 'DESACTIVADA'`],
      [
        `INSERT INTO scheduled_job_run (id, job, replica, started_at) VALUES (gen_random_uuid(), 'x-y-z', 'r', now())`,
      ],
    ])('%s → permiso denegado', async (sentencia) => {
      await expect(comoPlataforma((c) => c.query(sentencia))).rejects.toThrow(/permission denied/);
    });

    it('LecturaPlataforma abre transacciones de solo lectura', async () => {
      const soloLectura = await lectura.ejecutarLectura(async (trx) => {
        const { rows } = await sql<{
          valor: string;
        }>`select current_setting('transaction_read_only') as valor`.execute(trx);
        return rows[0].valor;
      });
      expect(soloLectura).toBe('on');
    });

    it('LecturaPlataforma no ofrece ninguna operación de escritura', () => {
      const metodos = Object.getOwnPropertyNames(Object.getPrototypeOf(lectura)).filter(
        (nombre) => nombre !== 'constructor',
      );
      expect(metodos.sort()).toEqual(['cerrar', 'ejecutarLectura']);
    });
  });

  describe('5. Lee entre barberías solo lo que le corresponde', () => {
    it('ve los pagos, suscripciones y barberías de todas, con el último tramo y el hash del número', async () => {
      const filas = await comoPlataforma(async (c) => {
        const { rows } = await c.query<{
          tenant_id: string;
          bank_operation_last4: string;
          bank_operation_hash: string;
          status: string;
        }>(
          `SELECT p.tenant_id, p.bank_operation_last4, p.bank_operation_hash, s.status
             FROM payment p JOIN subscription s ON s.id = p.subscription_id
            WHERE p.id = ANY($1)`,
          [tenants.map((t) => t.pagoId)],
        );
        return rows;
      });
      expect(filas.map((f) => f.tenant_id).sort()).toEqual(tenants.map((t) => t.tenantId).sort());
      for (const t of tenants) {
        const fila = filas.find((f) => f.tenant_id === t.tenantId);
        expect(fila).toEqual({
          tenant_id: t.tenantId,
          bank_operation_last4: t.numero.slice(-4),
          bank_operation_hash: createHash('sha256').update(t.numero).digest('hex'),
          status: 'TRIAL',
        });
        expect(JSON.stringify(fila)).not.toContain(t.numero);
      }
      const barberias = await comoPlataforma((c) =>
        c.query('SELECT id, name, slug, status FROM tenant WHERE id = ANY($1)', [
          tenants.map((t) => t.tenantId),
        ]),
      );
      expect(barberias.rows).toHaveLength(2);
    });

    it('la base calcula el último tramo y el hash: no se pueden escribir desalineados', async () => {
      await expect(
        poolDe('seed').query(`UPDATE payment SET bank_operation_last4 = '0000' WHERE id = $1`, [
          tenants[0].pagoId,
        ]),
      ).rejects.toThrow(/can only be updated to DEFAULT/);
    });
  });

  // T011 de 004 · ADR-025, ADR-031; constitución 1.4.1, principio III, tercera excepción: el despacho y el
  // envío listan pendientes leyendo solo columnas técnicas, sin el tipo ni el contenido.
  describe('5b. Tablas de 004', () => {
    it('outbox_event y notification: exactamente las cinco columnas técnicas', () => {
      expect([...COLUMNAS_PLATAFORMA_EVENTOS.outbox_event].sort()).toEqual(
        ['available_at', 'id', 'next_attempt_at', 'status', 'tenant_id'].sort(),
      );
      expect([...COLUMNAS_PLATAFORMA_AVISOS.notification].sort()).toEqual(
        ['claimed_until', 'id', 'next_attempt_at', 'status', 'tenant_id'].sort(),
      );
    });

    it.each([
      ['SELECT type FROM outbox_event'],
      ['SELECT payload FROM outbox_event'],
      ['SELECT replace_key FROM outbox_event'],
      ['SELECT * FROM outbox_event'],
      ['SELECT kind FROM notification'],
      ['SELECT recipient_ref FROM notification'],
      ['SELECT appointment_id FROM notification'],
      ['SELECT * FROM notification'],
      ...TABLAS_004_SIN_LECTURA_DE_PLATAFORMA.map((tabla) => [`SELECT * FROM ${tabla}`]),
    ])('%s → permiso denegado', async (consulta) => {
      await expect(comoPlataforma((c) => c.query(consulta))).rejects.toThrow(/permission denied/);
    });

    it('lee las columnas técnicas de los pendientes de todas las barberías (política plataforma_lectura)', async () => {
      const [a, b] = tenants;
      const ids = [uuidv7(), uuidv7()];
      for (const [i, t] of [a, b].entries()) {
        await poolDe('seed').query(
          `INSERT INTO outbox_event (id, tenant_id, type, payload, available_at, status, attempts)
           VALUES ($1, $2, 'CitaCreada', '{}', now(), 'PENDIENTE', 0)`,
          [ids[i], t.tenantId],
        );
      }
      const { rows } = await comoPlataforma((c) =>
        c.query('SELECT id, tenant_id, status FROM outbox_event WHERE id = ANY($1) ORDER BY id', [ids]),
      );
      expect(rows).toEqual([
        { id: ids[0], tenant_id: a.tenantId, status: 'PENDIENTE' },
        { id: ids[1], tenant_id: b.tenantId, status: 'PENDIENTE' },
      ]);
    });

    it('barberias_auth no tiene ningún permiso sobre ninguna tabla nueva', async () => {
      const { rows } = await poolDe('seed').query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'barberias_auth' AND table_name = ANY($1)
         UNION ALL
         SELECT table_name, privilege_type FROM information_schema.column_privileges
          WHERE grantee = 'barberias_auth' AND table_name = ANY($1)`,
        [TABLAS_004],
      );
      expect(rows).toEqual([]);
    });
  });

  // T005 de 008 · data-model §7 de 008, research R09: la tarea vencer-adelantos lista los candidatos leyendo solo
  // cinco columnas técnicas de booking_deposit; nada del monto, el código, el cliente ni los archivos.
  describe('5c. Tablas de 008', () => {
    it('booking_deposit: exactamente id, tenant_id, status, due_at y review_limit_at', async () => {
      expect([...COLUMNAS_PLATAFORMA_ADELANTOS.booking_deposit].sort()).toEqual(
        ['id', 'tenant_id', 'status', 'due_at', 'review_limit_at'].sort(),
      );
      expect(Object.keys(COLUMNAS_PLATAFORMA_ADELANTOS)).toEqual(['booking_deposit']);
      const { rows } = await poolDe('seed').query<{ columna: string }>(
        `SELECT column_name AS columna FROM information_schema.column_privileges
          WHERE grantee = 'barberias_plataforma' AND table_name = 'booking_deposit' AND privilege_type = 'SELECT'`,
      );
      expect(rows.map((f) => f.columna).sort()).toEqual(
        ['id', 'tenant_id', 'status', 'due_at', 'review_limit_at'].sort(),
      );
    });

    it.each([
      ['SELECT appointment_id FROM booking_deposit'],
      ['SELECT customer_id FROM booking_deposit'],
      ['SELECT customer_user_id FROM booking_deposit'],
      ['SELECT code FROM booking_deposit'],
      ['SELECT amount_cents FROM booking_deposit'],
      ['SELECT service_name FROM booking_deposit'],
      ['SELECT qr_file_id FROM booking_deposit'],
      ['SELECT * FROM booking_deposit'],
      ...TABLAS_008_SIN_LECTURA_DE_PLATAFORMA.map((tabla) => [`SELECT tenant_id FROM ${tabla}`]),
      ['SELECT content FROM booking_deposit_file'],
      ['SELECT operation_number FROM booking_deposit_payment'],
    ])('%s → permiso denegado', async (consulta) => {
      await expect(comoPlataforma((c) => c.query(consulta))).rejects.toThrow(/permission denied/);
    });

    it('nada sobre las otras tres tablas, ni de tabla ni de columna', async () => {
      const { rows } = await poolDe('seed').query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'barberias_plataforma' AND table_name = ANY($1)
         UNION ALL
         SELECT table_name, privilege_type FROM information_schema.column_privileges
          WHERE grantee = 'barberias_plataforma' AND table_name = ANY($1)`,
        [TABLAS_008_SIN_LECTURA_DE_PLATAFORMA],
      );
      expect(rows).toEqual([]);
    });

    it('lee las columnas técnicas de los adelantos de todas las barberías (política plataforma_lectura)', async () => {
      const ids: string[] = [];
      for (const t of tenants) {
        const { barberoId, servicioId, clienteId, usuarioClienteId } = await sembrarAgenda(t.tenantId);
        const citaId = await sembrarCita({
          tenantId: t.tenantId,
          barberoId,
          servicioId,
          clienteId,
          estado: 'PENDIENTE',
          inicio: new Date(Date.now() + 2 * DIA_MS),
        });
        const { adelantoId } = await sembrarFilas008({
          tenantId: t.tenantId,
          citaId,
          clienteId,
          usuarioClienteId,
          usuarioId: usuarioClienteId,
        });
        ids.push(adelantoId);
      }
      const { rows } = await comoPlataforma((c) =>
        c.query(
          `SELECT id, tenant_id, status FROM booking_deposit
            WHERE id = ANY($1) AND due_at IS NOT NULL AND review_limit_at IS NOT NULL ORDER BY id`,
          [ids],
        ),
      );
      expect(rows).toEqual(
        tenants
          .map((t, i) => ({ id: ids[i], tenant_id: t.tenantId, status: 'POR_REVISAR' }))
          .sort((x, y) => x.id.localeCompare(y.id)),
      );
    });

    it('no puede cambiar ningún adelanto', async () => {
      await expect(
        comoPlataforma((c) => c.query(`UPDATE booking_deposit SET status = 'VENCIDO'`)),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('6. barberias_app sobre las tablas de la plataforma (constitución 1.3.1)', () => {
    async function privilegiosDeTabla(tabla: string): Promise<string[]> {
      const { rows } = await poolDe('seed').query<{ privilegio: string }>(
        `SELECT privilege_type AS privilegio FROM information_schema.table_privileges
          WHERE grantee = 'barberias_app' AND table_schema = 'public' AND table_name = $1`,
        [tabla],
      );
      return rows.map((f) => f.privilegio).sort();
    }

    async function columnasCon(tabla: string, privilegio: string): Promise<string[]> {
      const { rows } = await poolDe('seed').query<{ columna: string }>(
        `SELECT column_name AS columna FROM information_schema.column_privileges
          WHERE grantee = 'barberias_app' AND table_schema = 'public' AND table_name = $1
            AND privilege_type = $2`,
        [tabla, privilegio],
      );
      return rows.map((f) => f.columna).sort();
    }

    it('provider_event: solo INSERT (sin SELECT, UPDATE ni DELETE)', async () => {
      expect(await privilegiosDeTabla('provider_event')).toEqual(['INSERT']);
      expect(await columnasCon('provider_event', 'SELECT')).toEqual([]);
      expect(await columnasCon('provider_event', 'UPDATE')).toEqual([]);
      await expect(como('app', null, (c) => c.query('SELECT event_id FROM provider_event'))).rejects.toThrow(
        /permission denied/,
      );
    });

    // ON CONFLICT (event_id) exigiría SELECT sobre event_id (la columna del árbitro); sin destino, solo INSERT.
    // event_id es la única clave única de la tabla, así que el efecto es el mismo.
    it('provider_event: INSERT ... ON CONFLICT DO NOTHING dice si el evento era nuevo sin poder leerlo', async () => {
      const eventoId = `evt_${uuidv7()}`;
      const insertar = (c: PoolClient) =>
        c.query(
          `INSERT INTO provider_event (event_id, provider_reference, reported_status, effect)
           VALUES ($1, 'ses_desconocida', 'APROBADO', 'SIN_PAGO') ON CONFLICT DO NOTHING`,
          [eventoId],
        );
      const filas = await como('app', null, async (c) => {
        const primera = await insertar(c);
        const repetida = await insertar(c);
        return [primera.rowCount, repetida.rowCount];
      });
      expect(filas).toEqual([1, 0]);
    });

    it('platform_admin: ningún permiso (sus secretos solo los lee barberias_plataforma)', async () => {
      expect(await privilegiosDeTabla('platform_admin')).toEqual([]);
      for (const privilegio of ['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) {
        expect(await columnasCon('platform_admin', privilegio)).toEqual([]);
      }
      await expect(
        como('app', null, (c) => c.query('SELECT totp_secret_enc FROM platform_admin')),
      ).rejects.toThrow(/permission denied/);
    });

    it.each(Object.entries(PERMISOS_APP_PLATAFORMA))(
      '%s: exactamente los privilegios de tabla y de UPDATE por columna previstos',
      async (tabla, { tabla: privilegios, update }) => {
        expect(await privilegiosDeTabla(tabla)).toEqual([...privilegios].sort());
        expect(await columnasCon(tabla, 'UPDATE')).toEqual([...update].sort());
      },
    );

    it('scheduled_job_run: INSERT, UPDATE de fin y conteos, y SELECT solo del id (para el WHERE)', async () => {
      expect(await privilegiosDeTabla('scheduled_job_run')).toEqual(['INSERT']);
      expect(await columnasCon('scheduled_job_run', 'UPDATE')).toEqual([...UPDATE_APP_TAREAS].sort());
      expect(await columnasCon('scheduled_job_run', 'SELECT')).toEqual(['id']);
    });

    it('tenant.status: el rol de la aplicación solo cambia la barbería de su transacción (H5)', async () => {
      const [a, b] = tenants;
      const cambiadas = await como('app', a.tenantId, async (c) => {
        const ajena = await c.query(`UPDATE tenant SET status = 'SUSPENDIDA' WHERE id = $1`, [b.tenantId]);
        const propia = await c.query(`UPDATE tenant SET status = 'ACTIVA' WHERE id = $1`, [a.tenantId]);
        return [ajena.rowCount, propia.rowCount];
      });
      expect(cambiadas).toEqual([0, 1]);
    });
  });
});
