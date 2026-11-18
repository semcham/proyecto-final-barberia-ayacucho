import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, Migrator, PostgresDialect } from 'kysely';
import { Client, Pool } from 'pg';
import { ProveedorDeMigraciones } from '../../../migrations';

// T059 de 007 · US3 (FR-019): la migración intentos_con_hash deja login_attempt sin ninguna IP legible. En una base
// aparte, migrada hasta la anterior, se siembran filas con la IP en claro; al migrar, no queda ninguna fila vieja ni la
// columna `ip`, y existe el índice por (email_hash, ip_hash, attempted_at). `down` vuelve a la columna `ip`, sin datos.

const ANTERIOR = '0034_vistas_de_conteo';
const MIGRACION = '0035_intentos_con_hash';
const ROLES = readFileSync(join(__dirname, '..', '..', '..', '..', 'db', 'init', '01-roles.sql'), 'utf8');

function urlCon(base: string, cambios: { usuario?: string; clave?: string; base?: string }): string {
  const url = new URL(base);
  if (cambios.usuario) url.username = cambios.usuario;
  if (cambios.clave) url.password = cambios.clave;
  if (cambios.base) url.pathname = `/${cambios.base}`;
  return url.toString();
}

async function consulta<T extends Record<string, unknown>>(
  url: string,
  texto: string,
  valores: unknown[] = [],
) {
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    return (await cliente.query<T>(texto, valores)).rows;
  } finally {
    await cliente.end();
  }
}

async function migrarA(urlDueno: string, nombre: string): Promise<void> {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: urlDueno, max: 1 }) }),
  });
  try {
    const { error } = await new Migrator({ db, provider: new ProveedorDeMigraciones() }).migrateTo(nombre);
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

describe('T059 · Migración de login_attempt al origen derivado (FR-019)', () => {
  const seed = process.env.TEST_DB_SEED_URL as string;
  const nombre = `intentos_${randomBytes(4).toString('hex')}`;
  const base = urlCon(seed, { base: nombre });
  const dueno = urlCon(seed, { usuario: 'barberias_owner', clave: 'barberias_owner_dev', base: nombre });

  const columnas = async () =>
    (
      await consulta<{ columna: string }>(
        base,
        `SELECT column_name AS columna FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'login_attempt' ORDER BY ordinal_position`,
      )
    ).map((f) => f.columna);

  beforeAll(async () => {
    await consulta(seed, `CREATE DATABASE ${nombre}`);
    const cliente = new Client({ connectionString: base });
    await cliente.connect();
    await cliente.query(ROLES);
    await cliente.end();
    await migrarA(dueno, ANTERIOR);
  });

  afterAll(async () => {
    await consulta(seed, `DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
  });

  it('antes, login_attempt guarda la IP en claro', async () => {
    expect(await columnas()).toEqual(['id', 'email_hash', 'ip', 'attempted_at']);
    await consulta(
      base,
      `INSERT INTO login_attempt (email_hash, ip, attempted_at)
       VALUES (repeat('a', 64), '203.0.113.5', now()), (repeat('b', 64), '198.51.100.7', now() - interval '1 hour')`,
    );
    expect(await consulta(base, 'SELECT id FROM login_attempt')).toHaveLength(2);
  });

  it('al migrar, no queda ninguna fila vieja ni la columna ip, y existe el índice por el origen derivado', async () => {
    await migrarA(dueno, MIGRACION);
    expect(await columnas()).toEqual(['id', 'email_hash', 'attempted_at', 'ip_hash']);
    expect(await consulta(base, 'SELECT * FROM login_attempt')).toEqual([]);
    const tipo = await consulta<{ tipo: string; nulo: string }>(
      base,
      `SELECT data_type || '(' || character_maximum_length || ')' AS tipo, is_nullable AS nulo
         FROM information_schema.columns WHERE table_name = 'login_attempt' AND column_name = 'ip_hash'`,
    );
    expect(tipo).toEqual([{ tipo: 'character(64)', nulo: 'NO' }]);
    const indices = await consulta<{ indice: string; definicion: string }>(
      base,
      `SELECT indexname AS indice, indexdef AS definicion FROM pg_indexes WHERE tablename = 'login_attempt'
        ORDER BY indexname`,
    );
    expect(indices.map((i) => i.indice)).toEqual(
      expect.arrayContaining(['login_attempt_cuenta_origen', 'login_attempt_antiguedad']),
    );
    expect(indices.map((i) => i.indice)).not.toContain('login_attempt_cuenta_ip');
    expect(indices.find((i) => i.indice === 'login_attempt_cuenta_origen')?.definicion).toContain(
      '(email_hash, ip_hash, attempted_at)',
    );
  });

  it('los permisos de barberias_app no cambian: SELECT, INSERT y DELETE', async () => {
    const privilegios = await consulta<{ privilegio: string }>(
      base,
      `SELECT privilege_type AS privilegio FROM information_schema.table_privileges
        WHERE grantee = 'barberias_app' AND table_name = 'login_attempt' ORDER BY 1`,
    );
    expect(privilegios.map((p) => p.privilegio)).toEqual(['DELETE', 'INSERT', 'SELECT']);
  });

  it('down vuelve a la columna ip, sin datos', async () => {
    await consulta(
      base,
      `INSERT INTO login_attempt (email_hash, ip_hash, attempted_at) VALUES (repeat('c', 64), repeat('d', 64), now())`,
    );
    await migrarA(dueno, ANTERIOR);
    expect(await columnas()).toEqual(['id', 'email_hash', 'attempted_at', 'ip']);
    expect(await consulta(base, 'SELECT * FROM login_attempt')).toEqual([]);
    const indices = await consulta<{ indice: string }>(
      base,
      `SELECT indexname AS indice FROM pg_indexes WHERE tablename = 'login_attempt'`,
    );
    expect(indices.map((i) => i.indice)).toContain('login_attempt_cuenta_ip');
  });
});
