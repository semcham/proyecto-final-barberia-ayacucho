import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Kysely, Migrator, PostgresDialect } from 'kysely';
import { Client, Pool } from 'pg';
import { ProveedorDeMigraciones } from '../../../migrations';
import { migrarHastaLaUltima } from '../../../src/shared/persistence/migrate';
import { crearApp } from '../../helpers/app';
import { cerrarPools } from '../../helpers/test-db';

// T019 · GET /salud/listo (FR-004, research.md R02 y R03): una réplica no se declara lista hasta poder
// atender (base accesible y migraciones al día), sin depender de Redis, y las migraciones se aplican una
// sola vez aunque dos procesos las lancen a la vez.

jest.setTimeout(120_000);

const LISTO = '/api/v1/salud/listo';
const ROLES = readFileSync(join(__dirname, '..', '..', '..', '..', 'db', 'init', '01-roles.sql'), 'utf8');

function urlCon(base: string, cambios: { usuario?: string; clave?: string; base?: string }): string {
  const url = new URL(base);
  if (cambios.usuario) url.username = cambios.usuario;
  if (cambios.clave) url.password = cambios.clave;
  if (cambios.base) url.pathname = `/${cambios.base}`;
  return url.toString();
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

/** Base vacía en el mismo servidor de pruebas, con los roles y permisos de db/init. */
async function baseVacia(): Promise<{ nombre: string; dueno: string; app: string; borrar(): Promise<void> }> {
  const seed = process.env.TEST_DB_SEED_URL as string;
  const nombre = `salud_${randomBytes(4).toString('hex')}`;
  await comoSuperusuario(seed, `CREATE DATABASE ${nombre}`);
  await comoSuperusuario(urlCon(seed, { base: nombre }), ROLES);
  return {
    nombre,
    dueno: urlCon(seed, { usuario: 'barberias_owner', clave: 'barberias_owner_dev', base: nombre }),
    app: urlCon(seed, { usuario: 'barberias_app', clave: 'barberias_app_dev', base: nombre }),
    borrar: () => comoSuperusuario(seed, `DROP DATABASE IF EXISTS ${nombre} WITH (FORCE)`),
  };
}

async function migrarHasta(urlDueno: string, ultima: string): Promise<void> {
  const db = new Kysely<unknown>({
    dialect: new PostgresDialect({ pool: new Pool({ connectionString: urlDueno, max: 1 }) }),
  });
  try {
    const { error } = await new Migrator({ db, provider: new ProveedorDeMigraciones() }).migrateTo(ultima);
    if (error) throw error;
  } finally {
    await db.destroy();
  }
}

describe('GET /salud/listo', () => {
  afterAll(async () => {
    await cerrarPools();
  });

  it('con la base de pruebas al día responde 200 { estado: "listo" }, sin Redis', async () => {
    const prueba = await crearApp({ entorno: { REDIS_URL: undefined } });
    try {
      const respuesta = await prueba.agente.get(LISTO).expect(200);
      expect(respuesta.body).toEqual({ estado: 'listo' });
    } finally {
      await prueba.cerrar();
    }
  });

  it('antes de la migración 0013 responde 503, y después de migrar, 200 (sin reiniciar)', async () => {
    const base = await baseVacia();
    try {
      await migrarHasta(base.dueno, '0012_lectura_publica');
      const prueba = await crearApp({ entorno: { DATABASE_URL_APP: base.app } });
      try {
        await prueba.agente.get(LISTO).expect(503);
        // La vivacidad no depende de las migraciones: la base responde.
        await prueba.agente.get('/api/v1/salud').expect(200);
        await migrarHastaLaUltima(base.dueno);
        const respuesta = await prueba.agente.get(LISTO).expect(200);
        expect(respuesta.body).toEqual({ estado: 'listo' });
      } finally {
        await prueba.cerrar();
      }
    } finally {
      await base.borrar();
    }
  });

  it('con la base caída responde 503', async () => {
    const prueba = await crearApp({
      entorno: { DATABASE_URL_APP: 'postgres://barberias_app:x@127.0.0.1:1/barberias' },
    });
    try {
      await prueba.agente.get(LISTO).expect(503);
    } finally {
      await prueba.cerrar();
    }
  });

  it('no tiene límite de solicitudes (el balanceador y Docker la consultan sin parar)', async () => {
    const prueba = await crearApp();
    try {
      const estados = new Set<number>();
      for (let i = 0; i < 320; i += 1) estados.add((await prueba.agente.get(LISTO)).status);
      expect([...estados]).toEqual([200]);
    } finally {
      await prueba.cerrar();
    }
  });
});

describe('Migraciones con dos procesos a la vez (R03)', () => {
  it('dos migrarHastaLaUltima en paralelo sobre una base vacía aplican cada migración una sola vez', async () => {
    const base = await baseVacia();
    try {
      await Promise.all([migrarHastaLaUltima(base.dueno), migrarHastaLaUltima(base.dueno)]);
      const cliente = new Client({ connectionString: base.dueno });
      await cliente.connect();
      try {
        const { rows } = await cliente.query<{ name: string; veces: number }>(
          'SELECT name, count(*)::int AS veces FROM kysely_migration GROUP BY name ORDER BY name',
        );
        const esperadas = Object.keys(await new ProveedorDeMigraciones().getMigrations()).sort();
        expect(rows.map((fila) => fila.name)).toEqual(esperadas);
        expect(rows.every((fila) => fila.veces === 1)).toBe(true);
      } finally {
        await cliente.end();
      }
    } finally {
      await base.borrar();
    }
  });
});
