import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarCliente,
  sembrarSesion,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T050 · Pruebas de ADR-015 (parte de PR09): funciones SECURITY DEFINER acotadas, roles y RLS en user_account.

const FUNCIONES = ['auth_resolver_cuenta', 'auth_buscar_sesion', 'auth_buscar_activacion'];
// 010 (T030; data-model §4; constitución 1.8.0 y ADR-036): las cuatro funciones de los enlaces de cuenta, del mismo rol.
const FUNCIONES_010 = [
  'auth_barberia_para_enlace',
  'auth_verificar_correo',
  'auth_restablecer_contrasena',
  'auth_marcar_verificada_por_activacion',
];
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

    it('auth_resolver_cuenta (0009, ADR-020): un cliente de 3 barberías da 1 fila, sin datos de membresía', async () => {
      // Barberías propias de esta prueba, para no alterar las cuentas visibles en A y B de la prueba (5).
      const [c1, c2, c3] = [await sembrarBarberia(), await sembrarBarberia(), await sembrarBarberia()];
      const cliente = await sembrarCliente({ tenantId: c1.tenantId });
      await sembrarCliente({ tenantId: c2.tenantId, usuarioId: cliente.usuarioId as string });
      await sembrarCliente({ tenantId: c3.tenantId, usuarioId: cliente.usuarioId as string });
      const filas = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_resolver_cuenta($1)', [cliente.correo])).rows,
      );
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        user_id: cliente.usuarioId,
        tenant_id: null,
        role_code: null,
        membership_status: null,
        tenant_status: null,
      });
      expect(filas[0].password_hash).toMatch(/^\$argon2id\$/);
    });

    it('auth_resolver_cuenta conserva dueño, SECURITY DEFINER, search_path fijo y permisos tras 0009', async () => {
      const { rows } = await poolDe('seed').query(
        `SELECT pg_get_userbyid(p.proowner) AS dueno, p.prosecdef AS definer, p.proconfig AS config,
                has_function_privilege('barberias_app', p.oid, 'EXECUTE') AS app,
                has_function_privilege('barberias_publico', p.oid, 'EXECUTE') AS publico
         FROM pg_proc p WHERE p.proname = 'auth_resolver_cuenta'`,
      );
      expect(rows).toEqual([
        {
          dueno: 'barberias_auth',
          definer: true,
          config: ['search_path=public, pg_temp'],
          app: true,
          publico: false,
        },
      ]);
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

    it('auth_buscar_sesion: también encuentra el token reemplazado por el período de gracia (T125, migración 0008)', async () => {
      const sembrada = await sembrarSesion({ tenantId: b.tenantId, usuarioId: b.propietarioId });
      const reemplazado = randomBytes(32).toString('base64url');
      await poolDe('seed').query(
        'UPDATE auth_session SET superseded_token_hash = $1 WHERE refresh_token_hash = $2',
        [hash(reemplazado), hash(sembrada.tokenRenovacion)],
      );
      const filas = await comoApp(
        async (c) => (await c.query('SELECT * FROM auth_buscar_sesion($1)', [hash(reemplazado)])).rows,
      );
      expect(filas).toEqual([expect.objectContaining({ tenant_id: b.tenantId, es_token_anterior: true })]);
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

  it('(3b) en auth_session, barberias_auth solo lee las columnas que usa auth_buscar_sesion', async () => {
    const { rows } = await poolDe('seed').query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
       WHERE grantee = 'barberias_auth' AND table_name = 'auth_session' AND privilege_type = 'SELECT'
       ORDER BY column_name`,
    );
    expect(rows.map((fila) => fila.column_name)).toEqual(
      [
        'id',
        'previous_token_hash',
        'refresh_token_hash',
        'status',
        'superseded_token_hash',
        'tenant_id',
        'user_id',
      ].sort(),
    );
  });

  describe('(4) barberias_app', () => {
    it('no tiene BYPASSRLS', async () => {
      const { rows } = await poolDe('seed').query(
        "SELECT rolbypassrls FROM pg_roles WHERE rolname = 'barberias_app'",
      );
      expect(rows[0].rolbypassrls).toBe(false);
    });

    it('solo puede ejecutar estas funciones SECURITY DEFINER del esquema (las 3 de ADR-015 y las 4 de 010)', async () => {
      const { rows } = await poolDe('seed').query<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('barberias_app', p.oid, 'EXECUTE')
         ORDER BY p.proname`,
      );
      expect(rows.map((fila) => fila.proname)).toEqual([...FUNCIONES, ...FUNCIONES_010].sort());
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

  describe('(7) funciones de los enlaces de cuenta (010, T030)', () => {
    it('cada una es de barberias_auth, SECURITY DEFINER, con search_path fijo; solo barberias_app la ejecuta', async () => {
      const { rows } = await poolDe('seed').query(
        `SELECT p.proname AS funcion, pg_get_userbyid(p.proowner) AS dueno, p.prosecdef AS definer,
                p.proconfig AS config,
                has_function_privilege('barberias_app', p.oid, 'EXECUTE') AS app,
                has_function_privilege('barberias_publico', p.oid, 'EXECUTE') AS publico,
                has_function_privilege('barberias_plataforma', p.oid, 'EXECUTE') AS plataforma,
                has_function_privilege('barberias_conteos', p.oid, 'EXECUTE') AS conteos
           FROM pg_proc p WHERE p.proname = ANY($1) ORDER BY p.proname`,
        [FUNCIONES_010],
      );
      expect(rows).toEqual(
        [...FUNCIONES_010].sort().map((funcion) => ({
          funcion,
          dueno: 'barberias_auth',
          definer: true,
          config: ['search_path=public, pg_temp'],
          app: true,
          publico: false,
          plataforma: false,
          conteos: false,
        })),
      );
    });

    it('ningún rol nuevo omite RLS: barberias_auth sigue siendo el único con BYPASSRLS (sin contar superusuarios)', async () => {
      const { rows } = await poolDe('seed').query<{ rolname: string }>(
        `SELECT rolname FROM pg_roles WHERE rolbypassrls AND NOT rolsuper ORDER BY rolname`,
      );
      expect(rows.map((f) => f.rolname)).toEqual(['barberias_auth']);
    });

    describe('comportamiento', () => {
      let c1: BarberiaSembrada;
      let c2: BarberiaSembrada;
      let clienteId: string;

      /** Enlace sembrado sin RLS; devuelve el token (solo su hash queda en la base). */
      async function sembrarEnlace(opciones: {
        tenantId: string;
        usuarioId: string;
        proposito: 'VERIFICAR_CORREO' | 'RECUPERAR_CONTRASENA';
        vencido?: boolean;
      }): Promise<{ id: string; token: string }> {
        const id = uuidv7();
        const token = randomBytes(32).toString('base64url');
        await poolDe('seed').query(
          `INSERT INTO account_link (id, tenant_id, user_id, purpose, token_hash, requested_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, now() - interval '2 hours',
                   now() + CASE WHEN $6 THEN interval '-1 minute' ELSE interval '1 hour' END)`,
          [
            id,
            opciones.tenantId,
            opciones.usuarioId,
            opciones.proposito,
            hash(token),
            opciones.vencido ?? false,
          ],
        );
        return { id, token };
      }

      const verificacionDe = async (usuarioId: string) =>
        (
          await poolDe('seed').query('SELECT email_verified_via AS via FROM user_account WHERE id = $1', [
            usuarioId,
          ])
        ).rows[0].via;

      beforeAll(async () => {
        [c1, c2] = [await sembrarBarberia(), await sembrarBarberia()];
        const cliente = await sembrarCliente({ tenantId: c1.tenantId });
        clienteId = cliente.usuarioId as string;
        await sembrarCliente({ tenantId: c2.tenantId, usuarioId: clienteId });
        // Una cuenta nueva (como las de 010): sin verificar.
        await poolDe('seed').query(
          'UPDATE user_account SET email_verified_at = NULL, email_verified_via = NULL WHERE id = $1',
          [clienteId],
        );
      });

      it('auth_verificar_correo: ninguna fila para un hash desconocido o de otro propósito', async () => {
        const recuperacion = await sembrarEnlace({
          tenantId: c1.tenantId,
          usuarioId: clienteId,
          proposito: 'RECUPERAR_CONTRASENA',
        });
        for (const token of ['no-existe', recuperacion.token]) {
          const filas = await comoApp(
            async (c) => (await c.query('SELECT * FROM auth_verificar_correo($1)', [hash(token)])).rows,
          );
          expect(filas).toEqual([]);
        }
      });

      it('auth_verificar_correo: aplica una vez, verifica la cuenta, anula los otros de verificación y luego rechaza', async () => {
        const otro = await sembrarEnlace({
          tenantId: c2.tenantId,
          usuarioId: clienteId,
          proposito: 'VERIFICAR_CORREO',
        });
        const enlace = await sembrarEnlace({
          tenantId: c1.tenantId,
          usuarioId: clienteId,
          proposito: 'VERIFICAR_CORREO',
        });
        const usar = (token: string) =>
          comoApp(async (c) => {
            const { rows } = await c.query('SELECT * FROM auth_verificar_correo($1)', [hash(token)]);
            await c.query('COMMIT');
            await c.query('BEGIN');
            return rows;
          });
        expect(await usar(enlace.token)).toEqual([
          { resultado: 'APLICADO', tenant_id: c1.tenantId, user_id: clienteId },
        ]);
        expect(await verificacionDe(clienteId)).toBe('ENLACE');
        // El enlace de la otra barbería quedó anulado: rechazado (con su cuenta y barbería, para auditar).
        expect(await usar(otro.token)).toEqual([
          { resultado: 'RECHAZADO', tenant_id: c2.tenantId, user_id: clienteId },
        ]);
        expect(await usar(enlace.token)).toEqual([
          { resultado: 'RECHAZADO', tenant_id: c1.tenantId, user_id: clienteId },
        ]);
      });

      it('auth_verificar_correo: un enlace vencido se rechaza y no verifica', async () => {
        const nuevo = await sembrarBarberia();
        const cuenta = (await sembrarCliente({ tenantId: nuevo.tenantId })).usuarioId as string;
        await poolDe('seed').query(
          'UPDATE user_account SET email_verified_at = NULL, email_verified_via = NULL WHERE id = $1',
          [cuenta],
        );
        const vencido = await sembrarEnlace({
          tenantId: nuevo.tenantId,
          usuarioId: cuenta,
          proposito: 'VERIFICAR_CORREO',
          vencido: true,
        });
        const filas = await comoApp(
          async (c) =>
            (await c.query('SELECT resultado FROM auth_verificar_correo($1)', [hash(vencido.token)])).rows,
        );
        expect(filas).toEqual([{ resultado: 'RECHAZADO' }]);
        expect(await verificacionDe(cuenta)).toBeNull();
      });

      it('auth_restablecer_contrasena: cambia la contraseña y revoca TODAS las sesiones de la cuenta, en sus dos barberías', async () => {
        const s1 = await sembrarSesion({ tenantId: c1.tenantId, usuarioId: clienteId });
        const s2 = await sembrarSesion({ tenantId: c2.tenantId, usuarioId: clienteId });
        const enlace = await sembrarEnlace({
          tenantId: c2.tenantId,
          usuarioId: clienteId,
          proposito: 'RECUPERAR_CONTRASENA',
        });
        const hashNuevo =
          '$argon2id$v=19$m=19456,t=2,p=1$c2FsdGRlcHJ1ZWJh$aGFzaGRlcHJ1ZWJhZGVsYWNvbnRyYXNlbmE';
        const filas = await comoApp(async (c) => {
          const { rows } = await c.query('SELECT * FROM auth_restablecer_contrasena($1, $2)', [
            hash(enlace.token),
            hashNuevo,
          ]);
          await c.query('COMMIT');
          await c.query('BEGIN');
          return rows;
        });
        expect(filas).toEqual([{ resultado: 'APLICADO', tenant_id: c2.tenantId, user_id: clienteId }]);
        const { rows } = await poolDe('seed').query(
          `SELECT status FROM auth_session WHERE refresh_token_hash = ANY($1) ORDER BY status`,
          [[hash(s1.tokenRenovacion), hash(s2.tokenRenovacion)]],
        );
        expect(rows).toEqual([{ status: 'REVOCADA' }, { status: 'REVOCADA' }]);
        const cuenta = await poolDe('seed').query('SELECT password_hash FROM user_account WHERE id = $1', [
          clienteId,
        ]);
        expect(cuenta.rows[0].password_hash).toBe(hashNuevo);
      });

      it('auth_restablecer_contrasena: rechaza un hash nuevo que no es argon2id, sin tocar nada', async () => {
        const enlace = await sembrarEnlace({
          tenantId: c1.tenantId,
          usuarioId: clienteId,
          proposito: 'RECUPERAR_CONTRASENA',
        });
        await expect(
          comoApp((c) =>
            c.query('SELECT * FROM auth_restablecer_contrasena($1, $2)', [hash(enlace.token), 'texto']),
          ),
        ).rejects.toThrow(/argon2id/);
      });

      it('auth_barberia_para_enlace: la preferida si hay membresía allí; si no, la del personal; si no, la más reciente', async () => {
        const elegir = (usuarioId: string, preferida: string | null) =>
          comoApp(
            async (c) =>
              (await c.query('SELECT auth_barberia_para_enlace($1, $2) AS t', [usuarioId, preferida])).rows[0]
                .t,
          );
        // Cliente de c1 y de c2 (c2 es la más reciente).
        expect(await elegir(clienteId, c1.tenantId)).toBe(c1.tenantId);
        expect(await elegir(clienteId, null)).toBe(c2.tenantId);
        const ajena = await sembrarBarberia();
        expect(await elegir(clienteId, ajena.tenantId)).toBe(c2.tenantId);
        // El propietario de c1, aunque pida otra barbería: la suya.
        expect(await elegir(c1.propietarioId, ajena.tenantId)).toBe(c1.tenantId);
        // Sin membresía activa: nada.
        const pendiente = await sembrarUsuario({
          tenantId: ajena.tenantId,
          rol: 'BARBERO',
          estado: 'PENDIENTE',
        });
        expect(await elegir(pendiente.usuarioId, ajena.tenantId)).toBeNull();
      });

      it('auth_marcar_verificada_por_activacion: solo con una activación ya usada de esa cuenta', async () => {
        const barberia = await sembrarBarberia();
        const barbero = await sembrarUsuario({
          tenantId: barberia.tenantId,
          rol: 'BARBERO',
          estado: 'PENDIENTE',
        });
        await poolDe('seed').query(
          'UPDATE user_account SET email_verified_at = NULL, email_verified_via = NULL WHERE id = $1',
          [barbero.usuarioId],
        );
        const marcar = () =>
          comoApp(async (c) => {
            await c.query('SELECT auth_marcar_verificada_por_activacion($1)', [barbero.usuarioId]);
            await c.query('COMMIT');
            await c.query('BEGIN');
          });
        await marcar();
        expect(await verificacionDe(barbero.usuarioId)).toBeNull();
        await poolDe('seed').query(
          `INSERT INTO account_activation (id, tenant_id, user_id, token_hash, expires_at, used_at, created_by)
           VALUES ($1, $2, $3, $4, now() + interval '72 hours', now(), $5)`,
          [uuidv7(), barberia.tenantId, barbero.usuarioId, hash(uuidv7()), barberia.propietarioId],
        );
        await marcar();
        expect(await verificacionDe(barbero.usuarioId)).toBe('ACTIVACION');
      });
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
