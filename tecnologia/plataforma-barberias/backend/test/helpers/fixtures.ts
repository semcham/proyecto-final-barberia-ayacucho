import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { poolDe } from './test-db';

// T015 · Datos sembrados directamente con el superusuario de pruebas (pool "seed", sin RLS), para que
// cada historia se pruebe sin depender de las demás.

export interface BarberiaSembrada {
  tenantId: string;
  propietarioId: string;
  correo: string;
  contrasena: string;
}

export interface UsuarioSembrado {
  usuarioId: string;
  correo: string;
  contrasena: string | null;
}

function correoUnico(prefijo: string): string {
  return `${prefijo}-${randomBytes(4).toString('hex')}@prueba.pe`;
}

async function hashArgon2(contrasena: string): Promise<string> {
  return argon2.hash(contrasena, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
}

export async function sembrarBarberia(
  opciones: {
    nombre?: string;
    estado?: 'ACTIVA' | 'SUSPENDIDA';
    propietario?: { correo?: string; nombre?: string; contrasena?: string };
  } = {},
): Promise<BarberiaSembrada> {
  const seed = poolDe('seed');
  const tenantId = uuidv7();
  const nombre = opciones.nombre ?? `Barbería ${randomBytes(2).toString('hex')}`;
  const slug = `barberia-${tenantId.slice(-12)}`;
  await seed.query('INSERT INTO tenant (id, name, slug, status) VALUES ($1, $2, $3, $4)', [
    tenantId,
    nombre,
    slug,
    opciones.estado ?? 'ACTIVA',
  ]);
  const propietario = await sembrarUsuario({
    tenantId,
    rol: 'PROPIETARIO',
    estado: 'ACTIVA',
    correo: opciones.propietario?.correo,
    nombre: opciones.propietario?.nombre,
    contrasena: opciones.propietario?.contrasena ?? 'clave-de-prueba-segura',
  });
  return {
    tenantId,
    propietarioId: propietario.usuarioId,
    correo: propietario.correo,
    contrasena: propietario.contrasena as string,
  };
}

export async function sembrarUsuario(opciones: {
  tenantId: string;
  rol: 'PROPIETARIO' | 'BARBERO';
  estado: 'PENDIENTE' | 'ACTIVA' | 'DESACTIVADA';
  correo?: string;
  nombre?: string;
  contrasena?: string | null;
}): Promise<UsuarioSembrado> {
  const seed = poolDe('seed');
  const usuarioId = uuidv7();
  const correo = (opciones.correo ?? correoUnico(opciones.rol.toLowerCase())).trim().toLowerCase();
  const contrasena = opciones.contrasena === undefined ? 'clave-de-prueba-segura' : opciones.contrasena;
  await seed.query('INSERT INTO user_account (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [
    usuarioId,
    correo,
    opciones.nombre ?? 'Usuario de Prueba',
    contrasena === null ? null : await hashArgon2(contrasena),
  ]);
  await seed.query(
    'INSERT INTO membership (id, tenant_id, user_id, role_code, status) VALUES ($1, $2, $3, $4, $5)',
    [uuidv7(), opciones.tenantId, usuarioId, opciones.rol, opciones.estado],
  );
  return { usuarioId, correo, contrasena };
}

/** Requiere la migración de suscripciones (US1). */
export async function sembrarSuscripcion(opciones: { tenantId: string; trialEndsAt: Date }): Promise<void> {
  const seed = poolDe('seed');
  const { rows } = await seed.query<{ existe: boolean }>(
    "SELECT to_regclass('public.subscription') IS NOT NULL AS existe",
  );
  if (!rows[0]?.existe) throw new Error('La tabla subscription aún no existe (migración de US1)');
  await seed.query(
    `INSERT INTO subscription (id, tenant_id, plan_id, status, started_at, trial_ends_at)
     SELECT $1, $2, p.id, 'TRIAL', now(), $3 FROM plan p WHERE p.code = 'TRIAL'`,
    [uuidv7(), opciones.tenantId, opciones.trialEndsAt],
  );
}

export interface SesionSembrada {
  sesionId: string;
  tokenRenovacion: string;
}

export async function sembrarSesion(opciones: {
  tenantId: string;
  usuarioId: string;
  estado?: 'ACTIVA' | 'CERRADA' | 'REVOCADA';
  ultimoUso?: Date;
  venceAbsoluto?: Date;
  terminadaEn?: Date;
}): Promise<SesionSembrada> {
  const seed = poolDe('seed');
  const sesionId = uuidv7();
  const tokenRenovacion = randomBytes(32).toString('base64url');
  const estado = opciones.estado ?? 'ACTIVA';
  const ahora = new Date();
  await seed.query(
    `INSERT INTO auth_session
       (id, tenant_id, user_id, refresh_token_hash, status, created_at, last_used_at, absolute_expires_at, ended_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sesionId,
      opciones.tenantId,
      opciones.usuarioId,
      createHash('sha256').update(tokenRenovacion).digest('hex'),
      estado,
      ahora,
      opciones.ultimoUso ?? ahora,
      opciones.venceAbsoluto ?? new Date(ahora.getTime() + 30 * 24 * 3600 * 1000),
      estado === 'ACTIVA' ? null : (opciones.terminadaEn ?? ahora),
    ],
  );
  return { sesionId, tokenRenovacion };
}

/** Filas de una tabla con tenant_id, leídas sin RLS, para comparar antes y después de una operación. */
export async function filasDe(tabla: string, tenantId: string): Promise<Record<string, unknown>[]> {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error(`Nombre de tabla no válido: ${tabla}`);
  const { rows } = await poolDe('seed').query(`SELECT * FROM ${tabla} WHERE tenant_id = $1 ORDER BY id`, [
    tenantId,
  ]);
  return rows;
}
