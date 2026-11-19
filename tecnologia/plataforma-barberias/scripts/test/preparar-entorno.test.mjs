// T008 de 009 · Generador del .env de desarrollo (FR-003, FR-017, FR-018; research R03).
// Ejecuta scripts/preparar-entorno.mjs como proceso aparte en un directorio temporal con una copia de .env.example.
// Nunca toca el .env de la carpeta del proyecto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../preparar-entorno.mjs', import.meta.url));
const EJEMPLO = fileURLToPath(new URL('../../.env.example', import.meta.url));

function directorio() {
  const dir = mkdtempSync(join(tmpdir(), 'preparar-entorno-'));
  copyFileSync(EJEMPLO, join(dir, '.env.example'));
  return dir;
}

function ejecutar(dir, ...args) {
  const r = spawnSync(process.execPath, [SCRIPT, '--dir', dir, ...args], { encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

function leerEnv(dir) {
  const valores = {};
  for (const linea of readFileSync(join(dir, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(linea);
    if (m) valores[m[1]] = m[2];
  }
  return valores;
}

const sinComillas = (v) => v.replace(/^"(.*)"$/, '$1');
const pem = (v) => sinComillas(v).replace(/\\n/g, '\n');
const hash = (ruta) => createHash('sha256').update(readFileSync(ruta)).digest('hex');

test('sin .env: lo crea con código 0 y claves que firman y verifican un JWT ES256', () => {
  const dir = directorio();
  try {
    const { codigo, salida } = ejecutar(dir);
    assert.equal(codigo, 0, salida);
    assert.ok(existsSync(join(dir, '.env')));
    const env = leerEnv(dir);
    assert.equal(env.JWT_ACTIVE_KID, 'dev-1');
    const privada = createPrivateKey(pem(env.JWT_PRIVATE_KEY));
    const publica = createPublicKey(pem(JSON.parse(env.JWT_PUBLIC_KEYS)['dev-1']));
    const datos = Buffer.from('cabecera.carga');
    const firma = sign('sha256', datos, { key: privada, dsaEncoding: 'ieee-p1363' });
    assert.equal(firma.length, 64, 'ES256 produce una firma de 64 bytes');
    assert.ok(verify('sha256', datos, { key: publica, dsaEncoding: 'ieee-p1363' }, firma));
    assert.equal(privada.asymmetricKeyDetails?.namedCurve, 'prime256v1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('las llaves son de 32 bytes y las dos sales tienen 32 o más caracteres y son distintas', () => {
  const dir = directorio();
  try {
    assert.equal(ejecutar(dir).codigo, 0);
    const env = leerEnv(dir);
    assert.equal(Buffer.from(env.PLATAFORMA_LLAVE_TOTP, 'base64').length, 32);
    assert.equal(Buffer.from(env.ENLACES_LLAVE, 'base64').length, 32);
    assert.notEqual(env.PLATAFORMA_LLAVE_TOTP, env.ENLACES_LLAVE);
    assert.ok(env.ENLACES_SAL_IP.length >= 32);
    assert.ok(env.INTENTOS_SAL_IP.length >= 32);
    assert.notEqual(env.ENLACES_SAL_IP, env.INTENTOS_SAL_IP);
    // Ningún valor de desarrollo del ejemplo queda tal cual en las variables generadas.
    const ejemplo = readFileSync(EJEMPLO, 'utf8');
    for (const nombre of ['PLATAFORMA_LLAVE_TOTP', 'ENLACES_LLAVE', 'ENLACES_SAL_IP', 'INTENTOS_SAL_IP']) {
      assert.ok(!ejemplo.includes(`${nombre}=${env[nombre]}`), `${nombre} debe ser nuevo`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('con --subred 172.29.0 fija la subred y todas las IP fijas con los sufijos de siempre', () => {
  const dir = directorio();
  try {
    assert.equal(ejecutar(dir, '--subred', '172.29.0').codigo, 0);
    const env = leerEnv(dir);
    assert.equal(env.RED_SUBRED, '172.29.0.0/24');
    const esperadas = {
      IP_NGINX: 10,
      IP_BACKEND_1: 11,
      IP_BACKEND_2: 12,
      IP_REDIS: 13,
      IP_SIMULADOR: 14,
      IP_MAILPIT: 15,
      IP_WHATSAPP: 16,
      IP_CLOUDFLARED: 17,
      IP_BACKEND_3: 18,
    };
    for (const [nombre, sufijo] of Object.entries(esperadas)) {
      assert.equal(env[nombre], `172.29.0.${sufijo}`, nombre);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('una subred inválida da código 1 y no crea nada', () => {
  const dir = directorio();
  try {
    for (const invalida of ['172.29', '300.1.1', 'abc', '10.0.0.0']) {
      const { codigo } = ejecutar(dir, '--subred', invalida);
      assert.equal(codigo, 1, invalida);
      assert.ok(!existsSync(join(dir, '.env')), invalida);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('con un .env existente al que le falta una variable: no lo toca, código 2, solo el nombre y ningún valor', () => {
  const dir = directorio();
  try {
    const contenido = [
      'DB_PUERTO=5433',
      'JWT_ACTIVE_KID=valor-secreto-que-no-debe-salir',
      'INTENTOS_SAL_IP=sal-secreta-que-no-debe-salir-0001',
      '',
    ].join('\n');
    writeFileSync(join(dir, '.env'), contenido);
    const antes = hash(join(dir, '.env'));
    for (const args of [[], ['--subred', '172.29.0']]) {
      const { codigo, salida } = ejecutar(dir, ...args);
      assert.equal(codigo, 2, salida);
      assert.equal(hash(join(dir, '.env')), antes, 'el .env existente no cambia');
      assert.match(salida, /ENLACES_SAL_IP/, 'informa el nombre que falta');
      assert.doesNotMatch(salida, /valor-secreto-que-no-debe-salir|sal-secreta-que-no-debe-salir/);
      assert.doesNotMatch(salida, /5433/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('con un .env completo: código 0, "no falta ninguna variable" y el archivo igual', () => {
  const dir = directorio();
  try {
    assert.equal(ejecutar(dir).codigo, 0);
    const antes = hash(join(dir, '.env'));
    const { codigo, salida } = ejecutar(dir);
    assert.equal(codigo, 0, salida);
    assert.match(salida, /no falta ninguna variable/i);
    assert.equal(hash(join(dir, '.env')), antes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ninguna salida muestra una clave privada ni un valor generado', () => {
  const dir = directorio();
  try {
    const { salida } = ejecutar(dir);
    assert.doesNotMatch(salida, /BEGIN (EC )?PRIVATE KEY/);
    const env = leerEnv(dir);
    for (const nombre of ['PLATAFORMA_LLAVE_TOTP', 'ENLACES_LLAVE', 'ENLACES_SAL_IP', 'INTENTOS_SAL_IP']) {
      assert.ok(!salida.includes(env[nombre]), `${nombre} no aparece en la salida`);
    }
    assert.match(salida, /generada/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
