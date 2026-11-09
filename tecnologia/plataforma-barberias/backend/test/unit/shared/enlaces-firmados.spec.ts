import * as crypto from 'node:crypto';
import { Clock } from '../../../src/shared/clock/clock';
import { EnlacesFirmados } from '../../../src/shared/enlaces/enlaces-firmados';

// node:crypto no deja redefinir sus funciones: timingSafeEqual se envuelve en un jest.fn que llama a la real,
// para comprobar que la verificación la usa.
jest.mock('node:crypto', () => {
  const real = jest.requireActual<typeof import('node:crypto')>('node:crypto');
  return { ...real, timingSafeEqual: jest.fn(real.timingSafeEqual) };
});

// T008 de 004 · Enlaces de acción firmados (ADR-032, contracts/enlaces-de-accion.md §1): emitir y verificar;
// alterado, con otra llave, vencido o con otro separador de dominio → rechazado; la firma se compara en
// tiempo constante; el token solo lleva identificadores opacos (sin datos personales).

class RelojFalso extends Clock {
  ms = Date.parse('2026-11-10T08:00:00Z');
  ahora(): Date {
    return new Date(this.ms);
  }
}

const LLAVE = Buffer.alloc(32, 5);
const TENANT = '0190f1a2-0000-7000-8000-000000000001';
const CITA = '0190f1a2-0000-7000-8000-0000000000aa';
const INICIO_CITA = new Date('2026-11-10T15:00:00Z');

function crear(llave = LLAVE) {
  const reloj = new RelojFalso();
  return { reloj, enlaces: new EnlacesFirmados(llave, reloj) };
}

function emitirUno(enlaces: EnlacesFirmados, accion: 'CONFIRMAR' | 'REPROGRAMAR' | 'CANCELAR' = 'CONFIRMAR') {
  return enlaces.emitir({ tenantId: TENANT, recursoId: CITA, accion, version: 3, venceEn: INICIO_CITA });
}

const base64url = (b: Buffer) => b.toString('base64url');

describe('EnlacesFirmados (ADR-032)', () => {
  it('emite un token que se verifica y devuelve los mismos datos', () => {
    const { enlaces } = crear();
    for (const accion of ['CONFIRMAR', 'REPROGRAMAR', 'CANCELAR'] as const) {
      const token = emitirUno(enlaces, accion);
      expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      expect(enlaces.verificar(token)).toEqual({
        valido: true,
        datos: { tenantId: TENANT, recursoId: CITA, accion, version: 3, venceEn: INICIO_CITA },
      });
    }
  });

  it('dos tokens de la misma cita y acción son distintos (parte aleatoria)', () => {
    const { enlaces } = crear();
    expect(emitirUno(enlaces)).not.toBe(emitirUno(enlaces));
  });

  it('el token solo lleva los 62 bytes del formato: identificadores opacos, sin datos personales', () => {
    const { enlaces } = crear();
    const [datos] = emitirUno(enlaces).split('.');
    const bytes = Buffer.from(datos, 'base64url');
    expect(bytes).toHaveLength(62);
    expect(bytes[0]).toBe(1);
    expect(bytes.subarray(1, 17).toString('hex')).toBe(TENANT.replace(/-/g, ''));
    expect(bytes.subarray(17, 33).toString('hex')).toBe(CITA.replace(/-/g, ''));
    expect(bytes[33]).toBe(1);
    expect(bytes.readUInt32BE(34)).toBe(3);
    expect(Number(bytes.readBigUInt64BE(38))).toBe(INICIO_CITA.getTime());
  });

  it('un token alterado en un byte se rechaza', () => {
    const { enlaces } = crear();
    const [datos, firma] = emitirUno(enlaces).split('.');
    const bytes = Buffer.from(datos, 'base64url');
    bytes[33] = 3; // CONFIRMAR → CANCELAR
    expect(enlaces.verificar(`${base64url(bytes)}.${firma}`)).toEqual({ valido: false, motivo: 'FIRMA' });
    const firmaBytes = Buffer.from(firma, 'base64url');
    firmaBytes[0] ^= 1;
    expect(enlaces.verificar(`${datos}.${base64url(firmaBytes)}`)).toEqual({
      valido: false,
      motivo: 'FIRMA',
    });
  });

  it('un token firmado con otra llave se rechaza', () => {
    const otro = crear(Buffer.alloc(32, 6)).enlaces;
    const { enlaces } = crear();
    expect(enlaces.verificar(emitirUno(otro))).toEqual({ valido: false, motivo: 'FIRMA' });
  });

  it('un token firmado con la misma llave pero otro separador de dominio se rechaza', () => {
    const { enlaces } = crear();
    const [datos] = emitirUno(enlaces).split('.');
    const bytes = Buffer.from(datos, 'base64url');
    const firmaAjena = crypto.createHmac('sha256', LLAVE).update('otro-uso-v1').update(bytes).digest();
    expect(enlaces.verificar(`${datos}.${base64url(firmaAjena)}`)).toEqual({
      valido: false,
      motivo: 'FIRMA',
    });
    const sinSeparador = crypto.createHmac('sha256', LLAVE).update(bytes).digest();
    expect(enlaces.verificar(`${datos}.${base64url(sinSeparador)}`)).toEqual({
      valido: false,
      motivo: 'FIRMA',
    });
  });

  it('vence a la hora indicada (la de inicio de la cita), según el reloj del servidor', () => {
    const { enlaces, reloj } = crear();
    const token = emitirUno(enlaces);
    reloj.ms = INICIO_CITA.getTime() - 1;
    expect(enlaces.verificar(token).valido).toBe(true);
    reloj.ms = INICIO_CITA.getTime();
    expect(enlaces.verificar(token)).toEqual({ valido: false, motivo: 'VENCIDO' });
  });

  it.each([
    ['vacío', ''],
    ['sin punto', 'abc'],
    ['con tres partes', 'a.b.c'],
    ['con caracteres fuera de base64url', 'ab+c.de/f'],
    ['con datos de otro largo', `${base64url(Buffer.alloc(61, 1))}.${base64url(Buffer.alloc(32))}`],
    ['con otro byte de formato', `${base64url(Buffer.alloc(62, 2))}.${base64url(Buffer.alloc(32))}`],
    ['con una firma de otro largo', `${base64url(Buffer.alloc(62, 1))}.${base64url(Buffer.alloc(31))}`],
    ['larguísimo', 'a'.repeat(5000)],
  ])('un token %s se rechaza por formato', (_caso, token) => {
    const { enlaces } = crear();
    expect(enlaces.verificar(token)).toEqual({ valido: false, motivo: 'FORMATO' });
  });

  it('compara la firma con timingSafeEqual (tiempo constante)', () => {
    const { enlaces } = crear();
    const token = emitirUno(enlaces);
    const comparacion = crypto.timingSafeEqual as jest.MockedFunction<typeof crypto.timingSafeEqual>;
    comparacion.mockClear();
    expect(enlaces.verificar(token).valido).toBe(true);
    expect(comparacion).toHaveBeenCalledTimes(1);
  });

  it('no emite con una versión, un identificador o una acción fuera del formato', () => {
    const { enlaces } = crear();
    const base = {
      tenantId: TENANT,
      recursoId: CITA,
      accion: 'CONFIRMAR' as const,
      version: 1,
      venceEn: INICIO_CITA,
    };
    expect(() => enlaces.emitir({ ...base, version: 0 })).toThrow();
    expect(() => enlaces.emitir({ ...base, version: 2 ** 32 })).toThrow();
    expect(() => enlaces.emitir({ ...base, tenantId: 'no-es-un-uuid' })).toThrow();
    expect(() => enlaces.emitir({ ...base, accion: 'BORRAR' as never })).toThrow();
  });

  it('exige una llave de 32 bytes', () => {
    expect(() => new EnlacesFirmados(Buffer.alloc(16), new RelojFalso())).toThrow();
  });
});
