import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { v7 as uuidv7 } from 'uuid';
import { poolDe } from './test-db';

// T015 · Datos sembrados directamente con el superusuario de pruebas (pool "seed", sin RLS), para que
// cada historia se pruebe sin depender de las demás.

export interface BarberiaSembrada {
  tenantId: string;
  slug: string;
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
    slug?: string;
    estado?: 'ACTIVA' | 'SUSPENDIDA';
    propietario?: { correo?: string; nombre?: string; contrasena?: string };
  } = {},
): Promise<BarberiaSembrada> {
  const seed = poolDe('seed');
  const tenantId = uuidv7();
  const nombre = opciones.nombre ?? `Barbería ${randomBytes(2).toString('hex')}`;
  const slug = opciones.slug ?? `barberia-${tenantId.slice(-12)}`;
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
    slug,
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

// --- Funcionalidad 002 (T011): catálogo, clientes y citas, sembrados sin RLS ---

/** Tramo semanal: día (0 = domingo … 6 = sábado) y horas locales 'HH:MM'. */
export interface TramoSembrado {
  dia: number;
  inicio: string;
  fin: string;
}

/** Lunes a sábado de 09:00 a 19:00: horario de atención por defecto de las pruebas. */
export const SEMANA_LABORAL: readonly TramoSembrado[] = [1, 2, 3, 4, 5, 6].map((dia) => ({
  dia,
  inicio: '09:00',
  fin: '19:00',
}));

export async function sembrarHorarioAtencion(
  tenantId: string,
  tramos: readonly TramoSembrado[] = SEMANA_LABORAL,
): Promise<void> {
  const seed = poolDe('seed');
  for (const tramo of tramos) {
    await seed.query(
      'INSERT INTO business_hours (id, tenant_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4, $5)',
      [uuidv7(), tenantId, tramo.dia, tramo.inicio, tramo.fin],
    );
  }
}

export interface ServicioSembrado {
  servicioId: string;
  nombre: string;
  duracionMin: number;
  precio: string;
}

export async function sembrarServicio(opciones: {
  tenantId: string;
  nombre?: string;
  precio?: string;
  duracionMin?: number;
  activo?: boolean;
}): Promise<ServicioSembrado> {
  const servicioId = uuidv7();
  const nombre = opciones.nombre ?? `Servicio ${randomBytes(3).toString('hex')}`;
  const duracionMin = opciones.duracionMin ?? 30;
  const precio = opciones.precio ?? '20.00';
  await poolDe('seed').query(
    `INSERT INTO service (id, tenant_id, name, price, duration_min, active)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [servicioId, opciones.tenantId, nombre, precio, duracionMin, opciones.activo ?? true],
  );
  return { servicioId, nombre, duracionMin, precio };
}

export async function sembrarBarbero(opciones: {
  tenantId: string;
  nombre?: string;
  usuarioId?: string;
  servicios?: readonly string[];
  activo?: boolean;
}): Promise<{ barberoId: string; nombre: string }> {
  const seed = poolDe('seed');
  const barberoId = uuidv7();
  const nombre = opciones.nombre ?? `Barbero ${randomBytes(2).toString('hex')}`;
  await seed.query(
    'INSERT INTO barber (id, tenant_id, user_id, display_name, active) VALUES ($1, $2, $3, $4, $5)',
    [barberoId, opciones.tenantId, opciones.usuarioId ?? null, nombre, opciones.activo ?? true],
  );
  for (const servicioId of opciones.servicios ?? []) {
    await seed.query('INSERT INTO barber_service (tenant_id, barber_id, service_id) VALUES ($1, $2, $3)', [
      opciones.tenantId,
      barberoId,
      servicioId,
    ]);
  }
  return { barberoId, nombre };
}

export async function sembrarDisponibilidad(
  tenantId: string,
  barberoId: string,
  tramos: readonly TramoSembrado[] = SEMANA_LABORAL,
): Promise<void> {
  const seed = poolDe('seed');
  for (const tramo of tramos) {
    await seed.query(
      `INSERT INTO working_hours (id, tenant_id, barber_id, weekday, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [uuidv7(), tenantId, barberoId, tramo.dia, tramo.inicio, tramo.fin],
    );
  }
}

export async function sembrarBloqueo(opciones: {
  tenantId: string;
  barberoId: string;
  inicio: Date;
  fin: Date;
  motivo?: string;
  creadoPor?: string;
}): Promise<string> {
  const id = uuidv7();
  await poolDe('seed').query(
    `INSERT INTO time_off (id, tenant_id, barber_id, starts_at, ends_at, reason, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      opciones.tenantId,
      opciones.barberoId,
      opciones.inicio,
      opciones.fin,
      opciones.motivo ?? null,
      opciones.creadoPor ?? uuidv7(),
    ],
  );
  return id;
}

export interface ClienteSembrado {
  clienteId: string;
  usuarioId: string | null;
  correo: string | null;
  telefono: string;
  contrasena: string | null;
}

/**
 * Cliente de una barbería. Con cuenta: cuenta (o la existente de `usuarioId`), membresía CLIENTE, perfil
 * EN_LINEA y consentimiento. Sin cuenta: perfil PRESENCIAL con el consentimiento anotado por `creadoPor`.
 */
export async function sembrarCliente(opciones: {
  tenantId: string;
  conCuenta?: boolean;
  usuarioId?: string;
  correo?: string;
  telefono?: string;
  nombre?: string;
  contrasena?: string;
  creadoPor?: string;
}): Promise<ClienteSembrado> {
  const seed = poolDe('seed');
  const conCuenta = opciones.conCuenta ?? true;
  const clienteId = uuidv7();
  const telefono = opciones.telefono ?? `9${randomBytes(4).readUInt32BE(0) % 100000000}`.padEnd(9, '0');
  const nombre = opciones.nombre ?? 'Cliente de Prueba';
  let usuarioId: string | null = null;
  let correo: string | null = opciones.correo?.trim().toLowerCase() ?? null;
  let contrasena: string | null = null;

  if (conCuenta) {
    if (opciones.usuarioId) {
      usuarioId = opciones.usuarioId;
      const { rows } = await seed.query<{ email: string }>('SELECT email FROM user_account WHERE id = $1', [
        usuarioId,
      ]);
      correo = rows[0].email;
    } else {
      usuarioId = uuidv7();
      correo = correo ?? correoUnico('cliente');
      contrasena = opciones.contrasena ?? 'clave-de-cliente-segura';
      await seed.query(
        'INSERT INTO user_account (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)',
        [usuarioId, correo, nombre, await hashArgon2(contrasena)],
      );
    }
    await seed.query(
      `INSERT INTO membership (id, tenant_id, user_id, role_code, status) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVA')`,
      [uuidv7(), opciones.tenantId, usuarioId],
    );
  }

  const creadoPor = conCuenta ? null : (opciones.creadoPor ?? uuidv7());
  await seed.query(
    `INSERT INTO customer_profile (id, tenant_id, user_id, full_name, email, phone, origin, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      clienteId,
      opciones.tenantId,
      usuarioId,
      nombre,
      correo,
      telefono,
      conCuenta ? 'EN_LINEA' : 'PRESENCIAL',
      creadoPor,
    ],
  );
  await seed.query(
    `INSERT INTO consent_record (id, tenant_id, customer_id, document, text_version, method, recorded_by)
     VALUES ($1, $2, $3, 'POLITICA_DATOS', '2026-10', $4, $5)`,
    [uuidv7(), opciones.tenantId, clienteId, conCuenta ? 'EN_LINEA' : 'PRESENCIAL', creadoPor],
  );
  return { clienteId, usuarioId, correo, telefono, contrasena };
}

export async function sembrarCita(opciones: {
  tenantId: string;
  barberoId: string;
  servicioId: string;
  clienteId: string;
  inicio: Date;
  duracionMin?: number;
  estado?: 'PENDIENTE' | 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO' | 'CANCELADA';
  creadoPor?: string;
}): Promise<string> {
  const id = uuidv7();
  const duracionMin = opciones.duracionMin ?? 30;
  const fin = new Date(opciones.inicio.getTime() + duracionMin * 60_000);
  const estado = opciones.estado ?? 'CONFIRMADA';
  await poolDe('seed').query(
    `INSERT INTO appointment
       (id, tenant_id, barber_id, service_id, customer_id, service_name, price, duration_min,
        starts_at, ends_at, status, origin, created_by, cancelled_at)
     VALUES ($1, $2, $3, $4, $5, 'Servicio sembrado', '20.00', $6, $7, $8, $9, 'EN_LINEA', $10, $11)`,
    [
      id,
      opciones.tenantId,
      opciones.barberoId,
      opciones.servicioId,
      opciones.clienteId,
      duracionMin,
      opciones.inicio,
      fin,
      estado,
      opciones.creadoPor ?? uuidv7(),
      estado === 'CANCELADA' ? new Date() : null,
    ],
  );
  return id;
}

/** Filas de una tabla con tenant_id, leídas sin RLS, para comparar antes y después de una operación. */
export async function filasDe(tabla: string, tenantId: string): Promise<Record<string, unknown>[]> {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error(`Nombre de tabla no válido: ${tabla}`);
  const { rows } = await poolDe('seed').query(`SELECT * FROM ${tabla} WHERE tenant_id = $1 ORDER BY id`, [
    tenantId,
  ]);
  return rows;
}
