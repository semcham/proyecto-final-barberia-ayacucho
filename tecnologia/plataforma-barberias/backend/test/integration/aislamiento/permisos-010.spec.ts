import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { type BaseAnterior, crearBaseEn, politicasDe } from '../../helpers/base-anterior';
import { sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T031 de 010 · PR09 de las tablas y columnas nuevas (data-model §1 a §3; constitución 1.8.0, principio III). La lista
// esperada se escribe aquí a mano, desde el modelo de datos, y no se importa de la migración:
// - account_link: RLS activada y forzada con tenant_isolation; barberias_app lee, inserta sin token ni uso, actualiza
//   solo token_hash y revoked_at, y borra (retención de 30 días); nunca used_at.
// - account_link_attempt: tabla técnica sin tenant_id ni RLS, solo para barberias_app.
// - user_account: las dos columnas nuevas solo con SELECT para la aplicación.
// - barberias_publico y barberias_plataforma: nada sobre lo nuevo.
// - Ninguna política RLS existente cambia: se comparan las de una base en 0035 con las de la misma base en 0036.

jest.setTimeout(240_000);

type Rol = 'barberias_app' | 'barberias_publico' | 'barberias_plataforma';

async function privilegiosDeTabla(rol: Rol, tabla: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ privilegio: string }>(
    `SELECT privilege_type AS privilegio FROM information_schema.table_privileges
      WHERE grantee = $1 AND table_schema = 'public' AND table_name = $2`,
    [rol, tabla],
  );
  return rows.map((f) => f.privilegio).sort();
}

/** Columnas sobre las que el rol tiene el privilegio (propio o heredado de un privilegio de tabla). */
async function columnasCon(rol: Rol, tabla: string, privilegio: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ columna: string }>(
    `SELECT a.attname AS columna
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege($1, c.oid, a.attnum, $3)
      ORDER BY a.attname`,
    [rol, tabla, privilegio],
  );
  return rows.map((f) => f.columna);
}

async function comoApp<T>(fn: (c: PoolClient) => Promise<T>, tenantId?: string): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    if (tenantId) await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

describe('PR09 · Permisos y RLS de 010 (data-model §1 a §3)', () => {
  afterAll(cerrarPools);

  describe('account_link', () => {
    it('tiene tenant_id y RLS activada y forzada, con tenant_isolation sobre el tenant de la transacción', async () => {
      const { rows } = await poolDe('seed').query(
        `SELECT relrowsecurity AS activada, relforcerowsecurity AS forzada FROM pg_class WHERE relname = 'account_link'`,
      );
      expect(rows).toEqual([{ activada: true, forzada: true }]);
      const politicas = await poolDe('seed').query<{ policyname: string; qual: string; with_check: string }>(
        `SELECT policyname, qual, with_check FROM pg_policies WHERE tablename = 'account_link'`,
      );
      expect(politicas.rows.map((p) => p.policyname)).toEqual(['tenant_isolation']);
      expect(politicas.rows[0].qual).toContain("current_setting('app.tenant_id'");
      expect(politicas.rows[0].with_check).toContain("current_setting('app.tenant_id'");
    });

    it('barberias_app: SELECT y DELETE de tabla; INSERT sin token ni uso; UPDATE solo de token_hash y revoked_at', async () => {
      expect(await privilegiosDeTabla('barberias_app', 'account_link')).toEqual(['DELETE', 'SELECT']);
      expect(await columnasCon('barberias_app', 'account_link', 'INSERT')).toEqual(
        ['expires_at', 'id', 'purpose', 'requested_at', 'tenant_id', 'user_id'].sort(),
      );
      expect(await columnasCon('barberias_app', 'account_link', 'UPDATE')).toEqual([
        'revoked_at',
        'token_hash',
      ]);
    });

    it.each<Rol>(['barberias_publico', 'barberias_plataforma'])('%s: ningún permiso', async (rol) => {
      expect(await privilegiosDeTabla(rol, 'account_link')).toEqual([]);
      for (const privilegio of ['SELECT', 'INSERT', 'UPDATE']) {
        expect(await columnasCon(rol, 'account_link', privilegio)).toEqual([]);
      }
    });

    it('con RLS: desde la barbería A no se ve ni se anula un enlace de B; sin tenant, ninguno', async () => {
      const [a, b] = [await sembrarBarberia(), await sembrarBarberia()];
      const usuarioB = (await sembrarCliente({ tenantId: b.tenantId })).usuarioId as string;
      const enlaceB = uuidv7();
      await poolDe('seed').query(
        `INSERT INTO account_link (id, tenant_id, user_id, purpose, requested_at, expires_at)
         VALUES ($1, $2, $3, 'VERIFICAR_CORREO', now(), now() + interval '24 hours')`,
        [enlaceB, b.tenantId, usuarioB],
      );
      const visibles = await comoApp(
        (c) => c.query('SELECT id FROM account_link WHERE id = $1', [enlaceB]),
        a.tenantId,
      );
      expect(visibles.rows).toEqual([]);
      const anulados = await comoApp(
        (c) => c.query('UPDATE account_link SET revoked_at = now() WHERE id = $1', [enlaceB]),
        a.tenantId,
      );
      expect(anulados.rowCount).toBe(0);
      expect((await comoApp((c) => c.query('SELECT id FROM account_link'))).rows).toEqual([]);
      const enB = await comoApp(
        (c) => c.query('SELECT id FROM account_link WHERE id = $1', [enlaceB]),
        b.tenantId,
      );
      expect(enB.rows).toEqual([{ id: enlaceB }]);
    });

    it('la aplicación no puede marcar un enlace como usado', async () => {
      const a = await sembrarBarberia();
      await expect(
        comoApp((c) => c.query('UPDATE account_link SET used_at = now()'), a.tenantId),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('account_link_attempt', () => {
    it('no tiene tenant_id ni RLS: solo el tipo, los hashes y la fecha', async () => {
      const { rows } = await poolDe('seed').query<{ columna: string }>(
        `SELECT column_name AS columna FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'account_link_attempt' ORDER BY ordinal_position`,
      );
      expect(rows.map((f) => f.columna)).toEqual(['id', 'kind', 'subject_hash', 'origin_hash', 'at']);
      const rls = await poolDe('seed').query(
        `SELECT relrowsecurity AS activada FROM pg_class WHERE relname = 'account_link_attempt'`,
      );
      expect(rls.rows).toEqual([{ activada: false }]);
    });

    it('solo barberias_app: SELECT, INSERT y DELETE, sin UPDATE', async () => {
      expect(await privilegiosDeTabla('barberias_app', 'account_link_attempt')).toEqual([
        'DELETE',
        'INSERT',
        'SELECT',
      ]);
      expect(await columnasCon('barberias_app', 'account_link_attempt', 'UPDATE')).toEqual([]);
      for (const rol of ['barberias_publico', 'barberias_plataforma'] as const) {
        expect(await privilegiosDeTabla(rol, 'account_link_attempt')).toEqual([]);
      }
    });

    it('barberias_app puede insertar sin permiso sobre ninguna secuencia (identidad)', async () => {
      await comoApp(async (c) => {
        await expect(
          c.query(
            `INSERT INTO account_link_attempt (kind, origin_hash, at) VALUES ('USO_FALLIDO', $1, now())`,
            ['b'.repeat(64)],
          ),
        ).resolves.toMatchObject({ rowCount: 1 });
      });
    });
  });

  describe('user_account', () => {
    it('barberias_app lee las dos columnas nuevas y no puede insertarlas ni actualizarlas', async () => {
      const nuevas = ['email_verified_at', 'email_verified_via'];
      const lee = await columnasCon('barberias_app', 'user_account', 'SELECT');
      const inserta = await columnasCon('barberias_app', 'user_account', 'INSERT');
      const actualiza = await columnasCon('barberias_app', 'user_account', 'UPDATE');
      expect(lee).toEqual(expect.arrayContaining(nuevas));
      for (const columna of nuevas) {
        expect(inserta).not.toContain(columna);
        expect(actualiza).not.toContain(columna);
      }
      // Lo de antes no cambia: inserta las columnas de 0001 y actualiza solo la contraseña y el nombre.
      expect(inserta).toEqual([
        'created_at',
        'email',
        'full_name',
        'id',
        'is_platform_admin',
        'password_hash',
      ]);
      expect(actualiza).toEqual(['full_name', 'password_hash']);
    });

    it.each<Rol>(['barberias_publico', 'barberias_plataforma'])(
      '%s: no lee las columnas nuevas',
      async (rol) => {
        const lee = await columnasCon(rol, 'user_account', 'SELECT');
        expect(lee).not.toContain('email_verified_at');
        expect(lee).not.toContain('email_verified_via');
      },
    );
  });

  describe('las políticas RLS existentes no cambian (FR-033)', () => {
    let base: BaseAnterior;

    beforeAll(async () => {
      base = await crearBaseEn('0035_intentos_con_hash');
    });

    afterAll(async () => {
      await base.eliminar();
    });

    it('las de una base en 0035 son las mismas en 0036, salvo la de la tabla nueva', async () => {
      const antes = await politicasDe(base.seed);
      await base.migrarA('0036_acceso_verificado');
      const despues = await politicasDe(base.seed);
      expect(despues.filter((p) => p.tablename !== 'account_link')).toEqual(antes);
      expect(despues.filter((p) => p.tablename === 'account_link').map((p) => p.policyname)).toEqual([
        'tenant_isolation',
      ]);
    });
  });
});
