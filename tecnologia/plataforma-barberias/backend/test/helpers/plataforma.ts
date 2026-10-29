import { randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import {
  codigoTotp,
  pasoDe,
  TotpNode,
} from '../../src/modules/acceso-barberias/identidad/infrastructure/totp-node';
import { Clock, Configuracion } from '../../src/shared';
import { poolDe } from './test-db';

// Ayudantes del administrador de la plataforma (003, fase 5): cuentas sembradas con el mismo cifrado y los
// mismos hashes que la orden plataforma:crear-admin, sesiones de plataforma y un reloj que las pruebas mueven
// de 30 en 30 segundos para que cada ingreso use un código TOTP nuevo sin esperar.

export interface AdminSembrado {
  adminId: string;
  correo: string;
  contrasena: string;
  /** Secreto TOTP en claro: solo lo conocen la prueba y la aplicación de autenticación del administrador. */
  secreto: Buffer;
  codigosRecuperacion: string[];
}

let totp: TotpNode | undefined;
const segundoFactor = () => (totp ??= new TotpNode(new Configuracion()));

/** Código TOTP del administrador para un instante. */
export function codigoPara(secreto: Buffer, instante: Date): string {
  return codigoTotp(secreto, pasoDe(instante));
}

/**
 * Administrador activo, como lo deja plataforma:crear-admin. Con `recuperacion: false` los hashes de los
 * códigos son de relleno (más rápido, para pruebas que no los usan).
 */
export async function sembrarAdminPlataforma(
  opciones: {
    adminId?: string;
    correo?: string;
    contrasena?: string;
    estado?: 'ACTIVA' | 'DESACTIVADA';
    recuperacion?: boolean;
  } = {},
): Promise<AdminSembrado> {
  const adminId = opciones.adminId ?? randomUUID();
  const correo = opciones.correo ?? `admin-${randomBytes(4).toString('hex')}@plataforma.prueba`;
  const contrasena = opciones.contrasena ?? `clave-admin-${randomBytes(6).toString('hex')}`;
  const secreto = segundoFactor().generarSecreto();
  const { codigos, hashes } =
    opciones.recuperacion === false
      ? { codigos: [], hashes: Array.from({ length: 10 }, (_, i) => `sin-uso-${i}`) }
      : await segundoFactor().generarCodigosRecuperacion();
  await poolDe('seed').query(
    `INSERT INTO platform_admin (id, email, full_name, password_hash, totp_secret_enc, recovery_codes_hash, status)
     VALUES ($1, $2, 'Admin de Prueba', $3, $4, $5, $6)`,
    [
      adminId,
      correo,
      await argon2.hash(contrasena, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      }),
      segundoFactor().cifrar(secreto, adminId),
      hashes,
      opciones.estado ?? 'ACTIVA',
    ],
  );
  return { adminId, correo, contrasena, secreto, codigosRecuperacion: codigos };
}

/** Sesión de plataforma ACTIVA (8 h) para firmar tokens a mano. Crea el administrador si no existe. */
export async function sembrarSesionPlataforma(
  adminId: string,
  sesionId: string = randomUUID(),
): Promise<string> {
  const seed = poolDe('seed');
  const { rowCount } = await seed.query('SELECT 1 FROM platform_admin WHERE id = $1', [adminId]);
  if (!rowCount) await sembrarAdminPlataforma({ adminId, recuperacion: false });
  await seed.query(
    `INSERT INTO platform_session (id, admin_id, refresh_token_hash, status, expires_at)
     VALUES ($1, $2, $3, 'ACTIVA', now() + interval '8 hours')`,
    [sesionId, adminId, randomBytes(32).toString('hex')],
  );
  return sesionId;
}

/**
 * Reloj de las pruebas del administrador: empieza en el instante real y solo avanza cuando la prueba lo pide,
 * de a un paso TOTP. Se mantiene cerca de la hora real porque login_attempt purga por antigüedad.
 */
export class RelojDePrueba extends Clock {
  private ms = Date.now();

  ahora(): Date {
    return new Date(this.ms);
  }

  /** Avanza al comienzo del siguiente paso de 30 s (un código nuevo). */
  siguientePaso(): Date {
    this.ms = (Math.floor(this.ms / 30_000) + 1) * 30_000 + 1_000;
    return this.ahora();
  }

  avanzar(ms: number): Date {
    this.ms += ms;
    return this.ahora();
  }
}
