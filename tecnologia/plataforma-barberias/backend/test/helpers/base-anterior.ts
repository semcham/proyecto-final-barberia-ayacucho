import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, Migrator, PostgresDialect } from 'kysely';
import { Client, Pool } from 'pg';
import { ProveedorDeMigraciones } from '../../migrations';

// 010 (T031, T032) · Una base de datos APARTE, en el mismo servidor de pruebas (Testcontainers o la base temporal de
// TEST_DATABASE_ADMIN_URL), migrada solo hasta una versión anterior. Sirve para probar una migración sobre datos que
// ya existían y comparar el esquema antes y después. Nunca toca la base de las demás pruebas.

const SCRIPT_ROLES = join(__dirname, '..', '..', '..', 'db', 'init', '01-roles.sql');

function conBase(url: string, base: string, usuario?: { nombre: string; clave: string }): string {
  const resultado = new URL(url);
  resultado.pathname = `/${base}`;
  if (usuario) {
    resultado.username = usuario.nombre;
    resultado.password = usuario.clave;
  }
  return resultado.toString();
}

async function comoSuperusuario(url: string, sqlTexto: string): Promise<void> {
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query(sqlTexto);
  } finally {
    await cliente.end();
  }
}

export interface BaseAnterior {
  /** Pool de superusuario (sin RLS) sobre la base aparte, para sembrar y comparar. */
  seed: Pool;
  /** Aplica las migraciones hasta `nombre` (hacia adelante o hacia atrás). */
  migrarA(nombre: string): Promise<void>;
  /** Deshace la última migración aplicada. */
  deshacerUna(): Promise<void>;
  eliminar(): Promise<void>;
}

/** Crea la base aparte, con los roles de db/init, y la migra hasta `version` (por ejemplo `0035_intentos_con_hash`). */
export async function crearBaseEn(version: string): Promise<BaseAnterior> {
  const urlSuperusuario = process.env.TEST_DB_SEED_URL;
  if (!urlSuperusuario)
    throw new Error('TEST_DB_SEED_URL no está definida: ¿corrió el globalSetup de las pruebas?');
  const nombre = `barberias_anterior_${randomBytes(4).toString('hex')}`;
  await comoSuperusuario(urlSuperusuario, `CREATE DATABASE ${nombre}`);
  const urlSeed = conBase(urlSuperusuario, nombre);
  await comoSuperusuario(urlSeed, readFileSync(SCRIPT_ROLES, 'utf8'));

  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: conBase(urlSuperusuario, nombre, {
          nombre: 'barberias_owner',
          clave: 'barberias_owner_dev',
        }),
        max: 1,
      }),
    }),
  });
  const migrador = new Migrator({ db, provider: new ProveedorDeMigraciones() });
  const comprobar = ({ error }: { error?: unknown }) => {
    if (error) throw error;
  };
  comprobar(await migrador.migrateTo(version));

  const seed = new Pool({ connectionString: urlSeed, max: 2 });
  return {
    seed,
    migrarA: async (destino) => comprobar(await migrador.migrateTo(destino)),
    deshacerUna: async () => comprobar(await migrador.migrateDown()),
    eliminar: async () => {
      await seed.end();
      await db.destroy();
      await comoSuperusuario(urlSuperusuario, `DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`);
    },
  };
}

/** Las políticas RLS de la base, en un orden estable (para comparar antes y después de una migración). */
export async function politicasDe(pool: Pool): Promise<Record<string, unknown>[]> {
  const { rows } = await pool.query(
    `SELECT tablename, policyname, permissive, roles::text AS roles, cmd, qual, with_check
       FROM pg_policies WHERE schemaname = 'public'
      ORDER BY tablename, policyname`,
  );
  return rows;
}
