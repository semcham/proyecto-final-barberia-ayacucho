import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { Injectable } from '@nestjs/common';
import argon2, { type HashOptions } from 'argon2';
import { Configuracion } from '../../../../shared';
import { type CodigosRecuperacion, SegundoFactor } from '../application/ports/segundo-factor';

const PASO_SEGUNDOS = 30;
const DIGITOS = 6;
const TOLERANCIA_PASOS = 1;
const BYTES_SECRETO = 20;
const EMISOR = 'Plataforma de barberías';

// Formato del secreto cifrado: versión (1 byte) | IV (12) | etiqueta GCM (16) | texto cifrado. La versión
// deja lugar a la rotación de la llave (L5) sin cambiar la columna.
const VERSION = 0x01;
const BYTES_IV = 12;
const BYTES_ETIQUETA = 16;

const CANTIDAD_RECUPERACION = 10;
// Sin I, L, O, U, 0 ni 1, que se confunden al copiar a mano: 30 símbolos, 12 por código (unos 59 bits).
const ALFABETO_RECUPERACION = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const LARGO_RECUPERACION = 12;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Código TOTP de un paso (RFC 6238 sobre el HOTP del RFC 4226, HMAC-SHA1). */
export function codigoTotp(secreto: Buffer, paso: number, digitos = DIGITOS): string {
  const contador = Buffer.alloc(8);
  contador.writeBigUInt64BE(BigInt(paso));
  const hmac = createHmac('sha1', secreto).update(contador).digest();
  const desplazamiento = hmac[hmac.length - 1] & 0x0f;
  const binario = hmac.readUInt32BE(desplazamiento) & 0x7fffffff;
  return String(binario % 10 ** digitos).padStart(digitos, '0');
}

/** Paso TOTP de un instante (segundos desde la época / 30). */
export function pasoDe(instante: Date): number {
  return Math.floor(instante.getTime() / 1000 / PASO_SEGUNDOS);
}

function base32(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += BASE32[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += BASE32[(valor << (5 - bits)) & 31];
  return salida;
}

/** Normaliza lo que escribe el administrador: mayúsculas, sin guiones ni espacios. */
function normalizarRecuperacion(codigo: string): string {
  return codigo.toUpperCase().replace(/[\s-]/g, '');
}

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * T067 · Segundo factor con `node:crypto` (R07): sin librería, con los vectores oficiales del RFC 6238 en las
 * pruebas. La llave AES-256-GCM sale de PLATAFORMA_LLAVE_TOTP; el id del administrador va como dato
 * autenticado, así que un secreto copiado a otra fila no se descifra.
 */
@Injectable()
export class TotpNode extends SegundoFactor {
  constructor(private readonly configuracion: Configuracion) {
    super();
  }

  generarSecreto(): Buffer {
    return randomBytes(BYTES_SECRETO);
  }

  cifrar(secreto: Buffer, adminId: string): Buffer {
    const iv = randomBytes(BYTES_IV);
    const cifrador = createCipheriv('aes-256-gcm', this.configuracion.plataforma.llaveTotp, iv);
    cifrador.setAAD(this.datoAsociado(adminId));
    const texto = Buffer.concat([cifrador.update(secreto), cifrador.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cifrador.getAuthTag(), texto]);
  }

  descifrar(cifrado: Buffer, adminId: string): Buffer {
    if (cifrado.length <= 1 + BYTES_IV + BYTES_ETIQUETA || cifrado[0] !== VERSION) {
      throw new Error('Secreto de segundo factor con formato desconocido');
    }
    const iv = cifrado.subarray(1, 1 + BYTES_IV);
    const etiqueta = cifrado.subarray(1 + BYTES_IV, 1 + BYTES_IV + BYTES_ETIQUETA);
    const descifrador = createDecipheriv('aes-256-gcm', this.configuracion.plataforma.llaveTotp, iv);
    descifrador.setAAD(this.datoAsociado(adminId));
    descifrador.setAuthTag(etiqueta);
    // `final()` lanza si el dato, el id o la llave no corresponden (la etiqueta GCM no verifica).
    return Buffer.concat([
      descifrador.update(cifrado.subarray(1 + BYTES_IV + BYTES_ETIQUETA)),
      descifrador.final(),
    ]);
  }

  uri(secreto: Buffer, correo: string): string {
    const etiqueta = encodeURIComponent(`${EMISOR}:${correo}`);
    const parametros = new URLSearchParams({
      secret: base32(secreto),
      issuer: EMISOR,
      algorithm: 'SHA1',
      digits: String(DIGITOS),
      period: String(PASO_SEGUNDOS),
    });
    return `otpauth://totp/${etiqueta}?${parametros.toString().replace(/\+/g, '%20')}`;
  }

  verificarCodigo(secreto: Buffer, codigo: string, ahora: Date, ultimoPaso: number | null): number | null {
    if (!/^[0-9]{6}$/.test(codigo)) return null;
    const actual = pasoDe(ahora);
    let aceptado: number | null = null;
    // Se comparan todos los pasos de la ventana, sin cortar al primero, para no variar el tiempo de respuesta.
    for (let paso = actual - TOLERANCIA_PASOS; paso <= actual + TOLERANCIA_PASOS; paso += 1) {
      const coincide = iguales(codigoTotp(secreto, paso), codigo);
      if (coincide && (ultimoPaso === null || paso > ultimoPaso) && aceptado === null) aceptado = paso;
    }
    return aceptado;
  }

  async generarCodigosRecuperacion(): Promise<CodigosRecuperacion> {
    const codigos = Array.from({ length: CANTIDAD_RECUPERACION }, () => {
      const simbolos = Array.from(
        { length: LARGO_RECUPERACION },
        () => ALFABETO_RECUPERACION[randomInt(ALFABETO_RECUPERACION.length)],
      ).join('');
      return `${simbolos.slice(0, 4)}-${simbolos.slice(4, 8)}-${simbolos.slice(8)}`;
    });
    const hashes = await Promise.all(
      codigos.map((codigo) => argon2.hash(normalizarRecuperacion(codigo), this.opcionesArgon2())),
    );
    return { codigos, hashes };
  }

  async verificarCodigoRecuperacion(
    codigo: string,
    hashes: readonly string[],
    usados: ReadonlySet<number>,
  ): Promise<number | null> {
    const normalizado = normalizarRecuperacion(codigo);
    if (normalizado.length !== LARGO_RECUPERACION) return null;
    let indice: number | null = null;
    // Se verifican los 10, también los ya usados, para que el tiempo no diga cuántos quedan.
    for (const [i, hash] of hashes.entries()) {
      let coincide = false;
      try {
        coincide = await argon2.verify(hash, normalizado);
      } catch {
        coincide = false;
      }
      if (coincide && !usados.has(i) && indice === null) indice = i;
    }
    return indice;
  }

  private datoAsociado(adminId: string): Buffer {
    return Buffer.from(`platform_admin:${adminId}`, 'utf8');
  }

  private opcionesArgon2(): HashOptions & { raw?: false } {
    const { memoriaKib, iteraciones, paralelismo } = this.configuracion.argon2;
    return { type: argon2.argon2id, memoryCost: memoriaKib, timeCost: iteraciones, parallelism: paralelismo };
  }
}
