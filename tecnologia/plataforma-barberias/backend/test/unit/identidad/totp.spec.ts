import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { Configuracion } from '../../../src/shared';
import {
  codigoTotp,
  pasoDe,
  TotpNode,
} from '../../../src/modules/acceso-barberias/identidad/infrastructure/totp-node';

// T063 · Segundo factor del administrador (R07): vectores del RFC 6238, tolerancia de ±1 paso, rechazo de un
// paso ya usado, cifrado AES-256-GCM del secreto y códigos de recuperación de un solo uso.

const configuracion = (llave = randomBytes(32)) =>
  ({
    plataforma: { llaveTotp: llave },
    // Argon2id con el mínimo que admite la librería: la prueba mide el comportamiento, no el costo.
    argon2: { memoriaKib: 1024, iteraciones: 1, paralelismo: 1 },
  }) as unknown as Configuracion;

// Apéndice B del RFC 6238: secreto ASCII "12345678901234567890" (SHA-1), códigos de 8 dígitos.
const SECRETO_RFC = Buffer.from('12345678901234567890', 'ascii');
const VECTORES: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP del administrador (T063)', () => {
  const totp = new TotpNode(configuracion());
  const ahora = new Date('2026-10-28T15:00:10Z');
  const paso = pasoDe(ahora);

  describe('RFC 6238', () => {
    it.each(VECTORES)('a los %i s da %s (8 dígitos) y sus últimos 6 con 6 dígitos', (segundos, esperado) => {
      const pasoRfc = Math.floor(segundos / 30);
      expect(codigoTotp(SECRETO_RFC, pasoRfc, 8)).toBe(esperado);
      expect(codigoTotp(SECRETO_RFC, pasoRfc)).toBe(esperado.slice(-6));
    });

    it('verifica cada vector en su instante', () => {
      for (const [segundos, esperado] of VECTORES) {
        expect(totp.verificarCodigo(SECRETO_RFC, esperado.slice(-6), new Date(segundos * 1000), null)).toBe(
          Math.floor(segundos / 30),
        );
      }
    });
  });

  describe('ventana y repetición', () => {
    const secreto = totp.generarSecreto();

    it('el secreto es de 20 bytes y cambia en cada generación', () => {
      expect(secreto).toHaveLength(20);
      expect(totp.generarSecreto().equals(secreto)).toBe(false);
    });

    it('acepta el paso actual y ±1, y nada más lejos', () => {
      expect(totp.verificarCodigo(secreto, codigoTotp(secreto, paso), ahora, null)).toBe(paso);
      expect(totp.verificarCodigo(secreto, codigoTotp(secreto, paso - 1), ahora, null)).toBe(paso - 1);
      expect(totp.verificarCodigo(secreto, codigoTotp(secreto, paso + 1), ahora, null)).toBe(paso + 1);
      for (const lejos of [paso - 2, paso + 2, paso - 10]) {
        const codigo = codigoTotp(secreto, lejos);
        // Un código lejano podría coincidir por azar con uno de la ventana (1 en un millón): se descarta.
        const enVentana = [paso - 1, paso, paso + 1].some((p) => codigoTotp(secreto, p) === codigo);
        if (!enVentana) expect(totp.verificarCodigo(secreto, codigo, ahora, null)).toBeNull();
      }
    });

    it('rechaza un código cuyo paso no es mayor que el último usado por el administrador', () => {
      const codigo = codigoTotp(secreto, paso);
      expect(totp.verificarCodigo(secreto, codigo, ahora, paso)).toBeNull();
      expect(totp.verificarCodigo(secreto, codigo, ahora, paso + 1)).toBeNull();
      expect(totp.verificarCodigo(secreto, codigo, ahora, paso - 1)).toBe(paso);
      // El anterior (dentro de la tolerancia) tampoco sirve si ya se entró con el actual.
      expect(totp.verificarCodigo(secreto, codigoTotp(secreto, paso - 1), ahora, paso)).toBeNull();
    });

    it('rechaza lo que no son 6 dígitos y el código de otro secreto', () => {
      for (const malo of ['', '12345', '1234567', 'abcdef', ' 123456', '12345a']) {
        expect(totp.verificarCodigo(secreto, malo, ahora, null)).toBeNull();
      }
      const otro = totp.generarSecreto();
      const ajeno = codigoTotp(otro, paso);
      const choca = [paso - 1, paso, paso + 1].some((p) => codigoTotp(secreto, p) === ajeno);
      if (!choca) expect(totp.verificarCodigo(secreto, ajeno, ahora, null)).toBeNull();
    });
  });

  describe('secreto cifrado con AES-256-GCM', () => {
    const adminId = randomUUID();
    const secreto = totp.generarSecreto();

    it('se descifra con la misma llave y el mismo administrador, y no contiene el secreto en claro', () => {
      const cifrado = totp.cifrar(secreto, adminId);
      expect(totp.descifrar(cifrado, adminId).equals(secreto)).toBe(true);
      expect(cifrado.includes(secreto)).toBe(false);
      // IV aleatorio: cifrar dos veces da datos distintos.
      expect(totp.cifrar(secreto, adminId).equals(cifrado)).toBe(false);
    });

    it('falla si se altera cualquier byte, con otro administrador o con otra llave', () => {
      const cifrado = totp.cifrar(secreto, adminId);
      for (const posicion of [0, 1, 13, 30, cifrado.length - 1]) {
        const alterado = Buffer.from(cifrado);
        alterado[posicion] ^= 0x01;
        expect(() => totp.descifrar(alterado, adminId)).toThrow();
      }
      expect(() => totp.descifrar(cifrado, randomUUID())).toThrow();
      expect(() => new TotpNode(configuracion()).descifrar(cifrado, adminId)).toThrow();
      expect(() => totp.descifrar(cifrado.subarray(0, 20), adminId)).toThrow();
    });
  });

  describe('URI otpauth', () => {
    it('lleva el secreto en base32, el emisor, SHA1, 6 dígitos y 30 s', () => {
      const uri = totp.uri(SECRETO_RFC, 'admin@plataforma.local');
      expect(uri).toMatch(
        /^otpauth:\/\/totp\/Plataforma%20de%20barber%C3%ADas%3Aadmin%40plataforma\.local\?/,
      );
      const parametros = new URL(uri).searchParams;
      // Base32 del secreto del RFC.
      expect(parametros.get('secret')).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
      expect(parametros.get('algorithm')).toBe('SHA1');
      expect(parametros.get('digits')).toBe('6');
      expect(parametros.get('period')).toBe('30');
      expect(parametros.get('issuer')).toBe('Plataforma de barberías');
    });
  });

  describe('códigos de recuperación', () => {
    it('genera 10 distintos, con hash Argon2id y sin el texto en el hash', async () => {
      const { codigos, hashes } = await totp.generarCodigosRecuperacion();
      expect(codigos).toHaveLength(10);
      expect(new Set(codigos).size).toBe(10);
      for (const codigo of codigos) expect(codigo).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      expect(hashes).toHaveLength(10);
      for (const [i, hash] of hashes.entries()) {
        expect(hash).toMatch(/^\$argon2id\$/);
        expect(hash).not.toContain(codigos[i].replace(/-/g, ''));
      }
    });

    it('cada código se acepta una sola vez, sin importar mayúsculas, guiones ni espacios', async () => {
      const { codigos, hashes } = await totp.generarCodigosRecuperacion();
      const usados = new Set<number>();
      const indice = await totp.verificarCodigoRecuperacion(codigos[3], hashes, usados);
      expect(indice).toBe(3);
      usados.add(3);
      expect(await totp.verificarCodigoRecuperacion(codigos[3], hashes, usados)).toBeNull();
      const escrito = ` ${codigos[7].toLowerCase().replace(/-/g, ' ')} `;
      expect(await totp.verificarCodigoRecuperacion(escrito, hashes, usados)).toBe(7);
      expect(await totp.verificarCodigoRecuperacion('AAAA-BBBB-CCCC', hashes, usados)).toBeNull();
      expect(await totp.verificarCodigoRecuperacion('corto', hashes, usados)).toBeNull();
    });
  });
});
