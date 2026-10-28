import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { COLUMNAS_PLATAFORMA, PERMISOS_APP_PLATAFORMA } from '../../../migrations/0016_plataforma';
import { COLUMNAS_PLATAFORMA_TAREAS, UPDATE_APP_TAREAS } from '../../../migrations/0017_tareas';
import { LecturaPlataforma } from '../../../src/shared/lectura-plataforma';
import { sembrarBarberia, sembrarPago, sembrarSuscripcion } from '../../helpers/fixtures';
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
};

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
