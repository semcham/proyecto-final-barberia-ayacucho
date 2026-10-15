import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarSesion,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T050 · Pruebas de ADR-015 (parte de PR09): funciones SECURITY DEFINER acotadas, roles y RLS en user_account.

const FUNCIONES = ['auth_resolver_cuenta', 'auth_buscar_sesion', 'auth_buscar_activacion'];
const hash = (texto: string) => createHash('sha256').update(texto).digest('hex');

async function comoApp<T>(fn: (cliente: PoolClient) => Promise<T>, tenantId?: string): Promise<T> {
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

describe('ADR-015: autenticación sin tenant y RLS en user_account', () => {
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  let correoBarberoB: string;
  let tokenSesionA: string;
  let tokenActivacionB: string;

  beforeAll(async () => {
    a = await sembrarBarberia();
    b = await sembrarBarberia();
    const barberoB = await sembrarUsuario({
      tenantId: b.tenantId,
      rol: 'BARBERO',
      estado: 'PENDIENTE',
      contrasena: null,
    });
    correoBarberoB = barberoB.correo;
    tokenSesionA = (await sembrarSesion({ tenantId: a.tenantId, usuarioId: a.propietarioId }))
      .tokenRenovacion;
    tokenActivacionB = randomBytes(32).toString('base64url');
    await poolDe('seed').query(
      `INSERT INTO account_activation (id, tenant_id, user_id, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, now() + interval '72 hours', $5)`,
      [uuidv7(), b.tenantId, barberoB.usuarioId, hash(tokenActivacionB), b.propietarioId],
    );
  });

  afterAll(cerrarPools);

  describe('(1) cada función devuelve como máximo una fila', () => {
    it('auth_resolver_cuenta: 1 fila para un correo existente (con su tenant y hash), 0 para uno inexistente', async () => {
      const filas = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_resolver_cuenta($1)', [a.correo])).rows,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        user_id: a.propietarioId,
        tenant_id: a.tenantId,
        role_code: 'PROPIETARIO',
        membership_status: 'ACTIVA',
        tenant_status: 'ACTIVA',
      });
      expect(filas[0].password_hash).toMatch(/^\$argon2id\$/);
      const ninguna = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_resolver_cuenta($1)', ['nadie@prueba.pe'])).rows,
      );
      expect(ninguna).toHaveLength(0);
    });

    it('auth_buscar_sesion: por token vigente, por token anterior (marcado) y 0 filas si no existe', async () => {
      const vigente = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_buscar_sesion($1)', [hash(tokenSesionA)])).rows,
      );
      expect(vigente).toEqual([expect.objectContaining({ tenant_id: a.tenantId, es_token_anterior: false })]);

      const nuevo = randomBytes(32).toString('base64url');
      await poolDe('seed').query(
        'UPDATE auth_session SET previous_token_hash = refresh_token_hash, refresh_token_hash = $1 WHERE refresh_token_hash = $2',
        [hash(nuevo), hash(tokenSesionA)],
      );
      const anterior = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_buscar_sesion($1)', [hash(tokenSesionA)])).rows,
      );
      expect(anterior).toEqual([expect.objectContaining({ tenant_id: a.tenantId, es_token_anterior: true })]);

      const ninguna = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_buscar_sesion($1)', [hash('no-existe')])).rows,
      );
      expect(ninguna).toHaveLength(0);
    });

    it('auth_buscar_activacion: 1 fila por su hash, 0 si no existe', async () => {
      const filas = await comoApp(
        async (c) =>
          (await c.query('SELECT * FROM auth_buscar_activacion($1)', [hash(tokenActivacionB)])).rows,
      );
      expect(filas).toEqual([
        expect.objectContaining({ tenant_id: b.tenantId, used_at: null, revoked_at: null }),
      ]);
      const ninguna = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_buscar_activacion($1)', [hash('no-existe')])).rows,
      );
      expect(ninguna).toHaveLength(0);
    });
  });

  it('(2) ninguna función recibe un parámetro de tenant: cada una recibe solo su clave de búsqueda', async () => {
    const { rows } = await poolDe('seed').query<{ proname: string; pronargs: number; argumentos: string }>(
      `SELECT proname, pronargs, pg_get_function_arguments(oid) AS argumentos
       FROM pg_proc WHERE proname = ANY($1) ORDER BY proname`,
      [FUNCIONES],
    );
    expect(rows).toHaveLength(3);
    for (const funcion of rows) {
      expect(funcion.pronargs).toBe(1);
      expect(funcion.argumentos).not.toMatch(/tenant/i);
    }
  });

  it('(3) barberias_auth no puede iniciar sesión, tiene BYPASSRLS y no es dueño de ninguna tabla', async () => {
    const seed = poolDe('seed');
    const { rows } = await seed.query(
      "SELECT rolcanlogin, rolbypassrls FROM pg_roles WHERE rolname = 'barberias_auth'",
    );
    expect(rows[0]).toEqual({ rolcanlogin: false, rolbypassrls: true });
    const tablas = await seed.query("SELECT tablename FROM pg_tables WHERE tableowner = 'barberias_auth'");
    expect(tablas.rows).toHaveLength(0);
    const duenos = await seed.query(
      'SELECT DISTINCT pg_get_userbyid(proowner) AS dueno, prosecdef FROM pg_proc WHERE proname = ANY($1)',
      [FUNCIONES],
    );
    expect(duenos.rows).toEqual([{ dueno: 'barberias_auth', prosecdef: true }]);
  });

  describe('(4) barberias_app', () => {
    it('no tiene BYPASSRLS', async () => {
      const { rows } = await poolDe('seed').query(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'barberias_app'",
      );
      expect(rows[0].rolbypassrls).toBe(false);
    });

    it('solo puede ejecutar estas 3 funciones SECURITY DEFINER del esquema', async () => {
      const { rows } = await poolDe('seed').query<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('barberias_app', p.oid, 'EXECUTE')
         ORDER BY p.proname`,
      );
      expect(rows.map((fila) => fila.proname)).toEqual([...FUNCIONES].sort());
    });

    it('no puede leer user_account.password_hash, ni siquiera dentro de su tenant', async () => {
      await expect(
        comoApp((c) => c.query('SELECT password_hash FROM user_account'), a.tenantId),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('(5) RLS en user_account', () => {
    it('sin contexto de tenant no ve ninguna cuenta', async () => {
      const { rows } = await comoApp((c) => c.query('SELECT count(*)::int AS total FROM user_account'));
      expect(rows[0].total).toBe(0);
    });

    it('con el contexto de A ve solo las cuentas de A', async () => {
      const { rows } = await comoApp(
        (c) => c.query<{ email: string }>('SELECT email FROM user_account'),
        a.tenantId,
      );
      expect(rows.map((fila) => fila.email)).toEqual([a.correo]);
      expect(rows.map((fila) => fila.email)).not.toContain(b.correo);
      expect(rows.map((fila) => fila.email)).not.toContain(correoBarberoB);
    });

    it('no puede modificar una cuenta de B desde el contexto de A', async () => {
      const { rowCount } = await comoApp(
        (c) => c.query("UPDATE user_account SET full_name = 'Cambiado' WHERE email = $1", [b.correo]),
        a.tenantId,
      );
      expect(rowCount).toBe(0);
    });
  });

  it('(6) insertar en user_account funciona sin RETURNING y falla con RETURNING', async () => {
    await comoApp(async (c) => {
      await expect(
        c.query('INSERT INTO user_account (id, email, full_name) VALUES ($1, $2, $3)', [
          uuidv7(),
          `nueva-${uuidv7()}@prueba.pe`,
          'Cuenta Nueva',
        ]),
      ).resolves.toMatchObject({ rowCount: 1 });
    }, a.tenantId);
    await expect(
      comoApp(
        (c) =>
          c.query('INSERT INTO user_account (id, email, full_name) VALUES ($1, $2, $3) RETURNING id', [
            uuidv7(),
            `otra-${uuidv7()}@prueba.pe`,
            'Otra Cuenta',
          ]),
        a.tenantId,
      ),
    ).rejects.toThrow(/row-level security/);
  });
});
