import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../clock/clock';

// T031 de 004 · Enlaces de acción firmados (ADR-032; contracts/enlaces-de-accion.md §1), en M06 y sin reglas
// de negocio. No se guarda nada al emitir: el enlace se valida solo con la llave.
//
//   token = base64url(datos) "." base64url(HMAC-SHA256(llave, "enlace-accion-v1" || datos))
//   datos (62 bytes) = formato (1) · tenant (16) · recurso (16) · acción (1) · versión (4) · vence (8, ms UNIX)
//                      · aleatorio (16)
//
// El token solo lleva identificadores opacos: ningún dato personal. La firma se compara en tiempo constante.

export type AccionDeEnlace = 'CONFIRMAR' | 'REPROGRAMAR' | 'CANCELAR';

export interface DatosDeEnlace {
  tenantId: string;
  /** La cita a la que alcanza el enlace (una sola). */
  recursoId: string;
  accion: AccionDeEnlace;
  /** Versión de la cita al emitirlo: cualquier cambio de la cita lo invalida. */
  version: number;
  venceEn: Date;
}

export type VerificacionDeEnlace =
  { valido: true; datos: DatosDeEnlace } | { valido: false; motivo: 'FORMATO' | 'FIRMA' | 'VENCIDO' };

const FORMATO = 1;
const LARGO_DATOS = 62;
const LARGO_FIRMA = 32;
/** Separa este uso de la llave de cualquier otro (contracts/enlaces-de-accion.md §1). */
const DOMINIO = Buffer.from('enlace-accion-v1', 'utf8');
/** Más que suficiente para 62 + 32 bytes en base64url; corta antes de decodificar un texto enorme. */
const LARGO_MAXIMO_TOKEN = 200;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CODIGO_DE_ACCION: Record<AccionDeEnlace, number> = { CONFIRMAR: 1, REPROGRAMAR: 2, CANCELAR: 3 };
const ACCION_DE_CODIGO = new Map<number, AccionDeEnlace>(
  Object.entries(CODIGO_DE_ACCION).map(([accion, codigo]) => [codigo, accion as AccionDeEnlace]),
);

function uuidABytes(valor: string): Buffer {
  if (!UUID.test(valor)) throw new Error('El identificador del enlace debe ser un uuid');
  return Buffer.from(valor.replace(/-/g, ''), 'hex');
}

function bytesAUuid(bytes: Buffer): string {
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class EnlacesFirmados {
  constructor(
    private readonly llave: Buffer,
    private readonly reloj: Clock,
  ) {
    if (llave.length !== 32) throw new Error('La llave de los enlaces debe tener 32 bytes');
  }

  emitir(datos: DatosDeEnlace): string {
    const codigo = CODIGO_DE_ACCION[datos.accion];
    if (codigo === undefined) throw new Error('Acción de enlace no válida');
    if (!Number.isInteger(datos.version) || datos.version < 1 || datos.version > 0xffffffff) {
      throw new Error('La versión del enlace debe ser un entero de 1 a 2^32 - 1');
    }
    const vence = datos.venceEn.getTime();
    if (!Number.isSafeInteger(vence) || vence <= 0) throw new Error('El vencimiento del enlace no es válido');

    const bytes = Buffer.alloc(LARGO_DATOS);
    bytes[0] = FORMATO;
    uuidABytes(datos.tenantId).copy(bytes, 1);
    uuidABytes(datos.recursoId).copy(bytes, 17);
    bytes[33] = codigo;
    bytes.writeUInt32BE(datos.version, 34);
    bytes.writeBigUInt64BE(BigInt(vence), 38);
    randomBytes(16).copy(bytes, 46);
    return `${bytes.toString('base64url')}.${this.firmar(bytes).toString('base64url')}`;
  }

  verificar(token: string): VerificacionDeEnlace {
    const partes = token.length <= LARGO_MAXIMO_TOKEN ? token.split('.') : [];
    if (partes.length !== 2 || !partes.every((p) => BASE64URL.test(p)))
      return { valido: false, motivo: 'FORMATO' };
    const bytes = Buffer.from(partes[0], 'base64url');
    const firma = Buffer.from(partes[1], 'base64url');
    if (bytes.length !== LARGO_DATOS || bytes[0] !== FORMATO || firma.length !== LARGO_FIRMA) {
      return { valido: false, motivo: 'FORMATO' };
    }
    if (!timingSafeEqual(firma, this.firmar(bytes))) return { valido: false, motivo: 'FIRMA' };

    const accion = ACCION_DE_CODIGO.get(bytes[33]);
    const version = bytes.readUInt32BE(34);
    const vence = Number(bytes.readBigUInt64BE(38));
    // Con la firma válida esto solo falla si la llave se usó para firmar otra cosa: se trata como formato.
    if (!accion || version < 1 || !Number.isSafeInteger(vence)) return { valido: false, motivo: 'FORMATO' };
    if (this.reloj.ahora().getTime() >= vence) return { valido: false, motivo: 'VENCIDO' };
    return {
      valido: true,
      datos: {
        tenantId: bytesAUuid(bytes.subarray(1, 17)),
        recursoId: bytesAUuid(bytes.subarray(17, 33)),
        accion,
        version,
        venceEn: new Date(vence),
      },
    };
  }

  private firmar(datos: Buffer): Buffer {
    return createHmac('sha256', this.llave).update(DOMINIO).update(datos).digest();
  }
}
