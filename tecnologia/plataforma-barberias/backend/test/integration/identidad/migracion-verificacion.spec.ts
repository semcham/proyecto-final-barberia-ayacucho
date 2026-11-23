import { v7 as uuidv7 } from 'uuid';
import type { PoolClient } from 'pg';
import { type BaseAnterior, crearBaseEn } from '../../helpers/base-anterior';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T032 de 010 · Migración 0036 (data-model §1 a §3; FR-016): toda cuenta existente queda verificada con 'MIGRACION'; las
// nuevas nacen sin verificar y la aplicación no puede crearlas verificadas; se cumplen los CHECK de las tablas nuevas;
// y la migración se puede deshacer y volver a aplicar.

jest.setTimeout(240_000);

const ANTERIOR = '0035_intentos_con_hash';
const NUEVA = '0036_acceso_verificado';
const HASH = 'a'.repeat(64);

async function comoApp<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

describe('Migración 0036: verificación del correo', () => {
  let anterior: BaseAnterior;

  beforeAll(async () => {
    anterior = await crearBaseEn(ANTERIOR);
  });

  afterAll(async () => {
    await anterior.eliminar();
    await cerrarPools();
  });

  it('las cuentas que ya existían quedan verificadas con MIGRACION (con y sin membresía)', async () => {
    const tenantId = uuidv7();
    const [conMembresia, sinMembresia] = [uuidv7(), uuidv7()];
    await anterior.seed.query(`INSERT INTO tenant (id, name, slug) VALUES ($1, 'Barbería Antigua', $2)`, [
      tenantId,
      `antigua-${tenantId.slice(-8)}`,
    ]);
    await anterior.seed.query(
      `INSERT INTO user_account (id, email, full_name) VALUES ($1, 'antes-1@prueba.pe', 'Cuenta Antigua'),
                                                           ($2, 'antes-2@prueba.pe', 'Otra Antigua')`,
      [conMembresia, sinMembresia],
    );
    await anterior.seed.query(
      `INSERT INTO membership (id, tenant_id, user_id, role_code, status) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVA')`,
      [uuidv7(), tenantId, conMembresia],
    );

    await anterior.migrarA(NUEVA);

    const { rows } = await anterior.seed.query(
      `SELECT email, email_verified_via AS via, email_verified_at IS NOT NULL AS con_fecha
         FROM user_account ORDER BY email`,
    );
    expect(rows).toEqual([
      { email: 'antes-1@prueba.pe', via: 'MIGRACION', con_fecha: true },
      { email: 'antes-2@prueba.pe', via: 'MIGRACION', con_fecha: true },
    ]);
  });

  it('se puede deshacer (vuelven las columnas de antes) y volver a aplicar', async () => {
    await anterior.deshacerUna();
    const columnas = async () =>
      (
        await anterior.seed.query<{ c: string }>(
          `SELECT column_name AS c FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'user_account' ORDER BY column_name`,
        )
      ).rows.map((f) => f.c);
    expect(await columnas()).not.toContain('email_verified_at');
    const tablas = await anterior.seed.query(
      `SELECT tablename FROM pg_tables WHERE tablename IN ('account_link', 'account_link_attempt')`,
    );
    expect(tablas.rows).toEqual([]);

    await anterior.migrarA(NUEVA);
    expect(await columnas()).toEqual(expect.arrayContaining(['email_verified_at', 'email_verified_via']));
  });

  describe('en la base de las pruebas (ya en 0036)', () => {
    let a: BarberiaSembrada;

    beforeAll(async () => {
      a = await sembrarBarberia();
    });

    it('una cuenta nueva que crea la aplicación nace sin verificar', async () => {
      const id = uuidv7();
      const correo = `nueva-${id.slice(-8)}@prueba.pe`;
      const { rows } = await comoApp(a.tenantId, async (c) => {
        await c.query('INSERT INTO user_account (id, email, full_name) VALUES ($1, $2, $3)', [
          id,
          correo,
          'Nueva',
        ]);
        await c.query(
          `INSERT INTO membership (id, tenant_id, user_id, role_code, status) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVA')`,
          [uuidv7(), a.tenantId, id],
        );
        return c.query('SELECT email_verified_at, email_verified_via FROM user_account WHERE id = $1', [id]);
      });
      expect(rows).toEqual([{ email_verified_at: null, email_verified_via: null }]);
    });

    it('la aplicación no puede crear una cuenta ya verificada ni marcarla verificada', async () => {
      await expect(
        comoApp(a.tenantId, (c) =>
          c.query(
            `INSERT INTO user_account (id, email, full_name, email_verified_at, email_verified_via)
             VALUES ($1, $2, 'Tramposa', now(), 'ENLACE')`,
            [uuidv7(), `tramposa-${uuidv7().slice(-8)}@prueba.pe`],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        comoApp(a.tenantId, (c) =>
          c.query(
            `UPDATE user_account SET email_verified_at = now(), email_verified_via = 'ENLACE' WHERE id = $1`,
            [a.propietarioId],
          ),
        ),
      ).rejects.toThrow(/permission denied/);
    });

    it('user_account: la fecha y la vía van juntas, y la vía es ENLACE, ACTIVACION o MIGRACION', async () => {
      const seed = poolDe('seed');
      // La cuenta sembrada después de 0036 nace sin verificar: una vía sin fecha, o una fecha sin vía, se rechazan.
      await expect(
        seed.query(`UPDATE user_account SET email_verified_via = 'ENLACE' WHERE id = $1`, [a.propietarioId]),
      ).rejects.toThrow(/user_account_verificacion_coherente/);
      await expect(
        seed.query(`UPDATE user_account SET email_verified_at = now() WHERE id = $1`, [a.propietarioId]),
      ).rejects.toThrow(/user_account_verificacion_coherente/);
      await expect(
        seed.query(
          `UPDATE user_account SET email_verified_at = now(), email_verified_via = 'OTRA' WHERE id = $1`,
          [a.propietarioId],
        ),
      ).rejects.toThrow(/check constraint/);
    });

    describe('account_link', () => {
      let usuarioId: string;
      const insertar = (valores: Partial<Record<string, unknown>> = {}) => {
        const fila = {
          id: uuidv7(),
          tenant_id: a.tenantId,
          user_id: usuarioId,
          purpose: 'VERIFICAR_CORREO',
          token_hash: null,
          requested_at: new Date('2026-11-23T15:00:00Z'),
          expires_at: new Date('2026-11-24T15:00:00Z'),
          used_at: null,
          revoked_at: null,
          ...valores,
        };
        return poolDe('seed').query(
          `INSERT INTO account_link (id, tenant_id, user_id, purpose, token_hash, requested_at, expires_at, used_at,
                                     revoked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          Object.values(fila),
        );
      };

      beforeAll(async () => {
        usuarioId = (await sembrarCliente({ tenantId: a.tenantId })).usuarioId as string;
      });

      it('un solo enlace sin usar ni anular por cuenta, propósito y barbería', async () => {
        await insertar();
        await expect(insertar()).rejects.toThrow(/account_link_uno_vigente/);
        // Otro propósito, o uno ya anulado, sí.
        await expect(insertar({ purpose: 'RECUPERAR_CONTRASENA' })).resolves.toBeDefined();
        await expect(insertar({ revoked_at: new Date() })).resolves.toBeDefined();
      });

      // Todos van anulados o con otro propósito, para que el índice de "uno vigente" no sea lo que falla.
      it.each([
        ['vence antes de pedirse', { expires_at: new Date('2026-11-23T14:00:00Z'), revoked_at: new Date() }],
        ['usado y anulado a la vez', { used_at: new Date(), revoked_at: new Date() }],
        ['propósito desconocido', { purpose: 'OTRO' }],
        ['hash que no es SHA-256 en hexadecimal', { token_hash: 'no-es-un-hash', revoked_at: new Date() }],
      ])('rechaza un enlace %s', async (_caso, valores) => {
        await expect(insertar(valores)).rejects.toThrow(/check constraint/);
      });

      it('la cuenta debe ser miembro de la barbería del enlace', async () => {
        const otra = await sembrarBarberia();
        await expect(insertar({ tenant_id: otra.tenantId })).rejects.toThrow(/foreign key/);
      });
    });

    describe('account_link_attempt', () => {
      const intento = (kind: string, sujeto: string | null, origen = HASH) =>
        poolDe('seed').query(
          'INSERT INTO account_link_attempt (kind, subject_hash, origin_hash, at) VALUES ($1, $2, $3, now())',
          [kind, sujeto, origen],
        );

      it('USO_FALLIDO va sin sujeto; REENVIO y RECUPERACION, con él', async () => {
        await expect(intento('USO_FALLIDO', null)).resolves.toBeDefined();
        await expect(intento('REENVIO', HASH)).resolves.toBeDefined();
        await expect(intento('USO_FALLIDO', HASH)).rejects.toThrow(/constraint/);
        await expect(intento('RECUPERACION', null)).rejects.toThrow(/constraint/);
      });

      it('el origen es siempre un hash de 64 caracteres hexadecimales, nunca una IP', async () => {
        await expect(intento('USO_FALLIDO', null, '203.0.113.7')).rejects.toThrow(/constraint/);
      });
    });
  });
});
