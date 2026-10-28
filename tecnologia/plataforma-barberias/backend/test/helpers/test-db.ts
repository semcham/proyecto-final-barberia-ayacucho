import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client, Pool } from 'pg';
import { migrarHastaLaUltima } from '../../src/shared/persistence/migrate';

/**
 * Base de datos de las pruebas de integración (T014).
 *
 * - Por defecto levanta postgres:16 con Testcontainers (CI y equipos con Docker).
 * - Si existe TEST_DATABASE_ADMIN_URL (URL de un superusuario de un PostgreSQL 16 ya disponible),
 *   crea en él una base temporal y la elimina al terminar. Sirve en equipos sin Docker.
 *
 * Expone cinco URL por variables de entorno para los workers de Jest:
 *   TEST_DB_APP_URL     → barberias_app (RLS activo; lo que usa la aplicación)
 *   TEST_DB_OWNER_URL   → barberias_owner (solo migraciones)
 *   TEST_DB_SEED_URL    → superusuario, SOLO en pruebas, para sembrar y comparar filas sin RLS (R04)
 *   TEST_DB_PUBLICO_URL → barberias_publico (lecturas públicas por enlace, ADR-021)
 *   TEST_DB_PLATAFORMA_URL → barberias_plataforma (lecturas entre barberías, ADR-031)
 */

const SCRIPT_ROLES = join(__dirname, '..', '..', '..', 'db', 'init', '01-roles.sql');

interface ContenedorIniciado {
  getConnectionUri(): string;
  stop(): Promise<unknown>;
}

interface EstadoGlobal {
  contenedor?: ContenedorIniciado;
  adminUrl?: string;
  baseTemporal?: string;
}

const estado = globalThis as typeof globalThis & { __BASE_PRUEBAS__?: EstadoGlobal };

function urlConCredenciales(base: string, usuario: string, clave: string, baseDatos?: string): string {
  const url = new URL(base);
  url.username = usuario;
  url.password = clave;
  if (baseDatos) url.pathname = `/${baseDatos}`;
  return url.toString();
}

async function ejecutarComoSuperusuario(url: string, sqlTexto: string): Promise<void> {
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query(sqlTexto);
  } finally {
    await cliente.end();
  }
}

async function prepararRolesYMigraciones(urlSuperusuario: string): Promise<void> {
  await ejecutarComoSuperusuario(urlSuperusuario, readFileSync(SCRIPT_ROLES, 'utf8'));
  const urlDueno = urlConCredenciales(urlSuperusuario, 'barberias_owner', 'barberias_owner_dev');
  await migrarHastaLaUltima(urlDueno);
  process.env.TEST_DB_SEED_URL = urlSuperusuario;
  process.env.TEST_DB_OWNER_URL = urlDueno;
  process.env.TEST_DB_APP_URL = urlConCredenciales(urlSuperusuario, 'barberias_app', 'barberias_app_dev');
  process.env.TEST_DB_PUBLICO_URL = urlConCredenciales(
    urlSuperusuario,
    'barberias_publico',
    'barberias_publico_dev',
  );
  process.env.TEST_DB_PLATAFORMA_URL = urlConCredenciales(
    urlSuperusuario,
    'barberias_plataforma',
    'barberias_plataforma_dev',
  );
}

export async function prepararBaseDePrueba(): Promise<void> {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  if (adminUrl) {
    const baseTemporal = `barberias_test_${randomBytes(4).toString('hex')}`;
    await ejecutarComoSuperusuario(adminUrl, `CREATE DATABASE ${baseTemporal}`);
    estado.__BASE_PRUEBAS__ = { adminUrl, baseTemporal };
    const url = new URL(adminUrl);
    url.pathname = `/${baseTemporal}`;
    await prepararRolesYMigraciones(url.toString());
    return;
  }

  const contenedor = await new PostgreSqlContainer('postgres:16').withDatabase('barberias').start();
  estado.__BASE_PRUEBAS__ = { contenedor };
  await prepararRolesYMigraciones(contenedor.getConnectionUri());
}

export async function liberarBaseDePrueba(): Promise<void> {
  const actual = estado.__BASE_PRUEBAS__;
  if (!actual) return;
  if (actual.contenedor) await actual.contenedor.stop();
  if (actual.adminUrl && actual.baseTemporal) {
    await ejecutarComoSuperusuario(
      actual.adminUrl,
      `DROP DATABASE IF EXISTS ${actual.baseTemporal} WITH (FORCE)`,
    );
  }
}

const pools = new Map<string, Pool>();

/** Pool para una prueba. Cerrar todos con `cerrarPools()` en afterAll. */
export function poolDe(rol: 'app' | 'owner' | 'seed' | 'publico' | 'plataforma', maxConexiones = 4): Pool {
  const variable = {
    app: 'TEST_DB_APP_URL',
    owner: 'TEST_DB_OWNER_URL',
    seed: 'TEST_DB_SEED_URL',
    publico: 'TEST_DB_PUBLICO_URL',
    plataforma: 'TEST_DB_PLATAFORMA_URL',
  }[rol];
  const url = process.env[variable];
  if (!url)
    throw new Error(`${variable} no está definida: ¿se ejecutó el globalSetup de jest.int.config.ts?`);
  const clave = `${rol}:${maxConexiones}`;
  let pool = pools.get(clave);
  if (!pool) {
    pool = new Pool({ connectionString: url, max: maxConexiones });
    pools.set(clave, pool);
  }
  return pool;
}

export async function cerrarPools(): Promise<void> {
  await Promise.all([...pools.values()].map((pool) => pool.end()));
  pools.clear();
}
