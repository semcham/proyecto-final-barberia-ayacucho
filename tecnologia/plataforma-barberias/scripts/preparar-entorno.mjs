#!/usr/bin/env node
// Funcionalidad 009 (US3, FR-003, FR-017, FR-018; research R03): genera el .env de DESARROLLO a partir de
// .env.example, con claves y sales nuevas. Uso:
//
//   node scripts/preparar-entorno.mjs [--dir <carpeta>] [--subred a.b.c]
//
// - Si .env NO existe: lo crea copiando .env.example y reemplazando las claves y sales (y, con --subred, la subred y
//   las IP fijas). La escritura es atómica y falla si el archivo apareció mientras tanto.
// - Si .env YA existe: no lo abre para escribir. Lee solo los NOMBRES de sus variables (nunca guarda ni imprime un
//   valor) e informa cuáles de .env.example le faltan.
// - Nunca imprime un secreto: solo dice "generada".
//
// Códigos de salida: 0 creado o completo; 2 faltan variables (el archivo no se tocó); 1 error o subred inválida.
// Solo usa módulos de Node (node:crypto y node:fs): sin dependencias.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, renameSync, rmSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUFIJOS_IP = {
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

function argumentos(argv) {
  const opciones = { dir: process.cwd(), subred: undefined };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') opciones.dir = argv[++i];
    else if (argv[i] === '--subred') opciones.subred = argv[++i];
    else throw new Error(`Argumento desconocido: ${argv[i]}`);
  }
  return opciones;
}

/** "172.29.0" → válido; cualquier otra forma (o un octeto fuera de 0–255) no. */
function subredValida(prefijo) {
  if (typeof prefijo !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(prefijo)) return false;
  return prefijo.split('.').every((o) => Number(o) <= 255);
}

const unaLinea = (pem) => pem.trim().replace(/\r?\n/g, '\\n');

function generar() {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const privada = unaLinea(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publica = unaLinea(publicKey.export({ type: 'spki', format: 'pem' }));
  const llaveTotp = randomBytes(32).toString('base64');
  let llaveEnlaces = randomBytes(32).toString('base64');
  while (llaveEnlaces === llaveTotp) llaveEnlaces = randomBytes(32).toString('base64');
  const salEnlaces = randomBytes(24).toString('base64url'); // 32 caracteres
  let salIntentos = randomBytes(24).toString('base64url');
  while (salIntentos === salEnlaces) salIntentos = randomBytes(24).toString('base64url');
  return {
    JWT_PRIVATE_KEY: `"${privada}"`,
    // JSON en una sola línea, como en .env.example; el "\n" literal lo interpreta JSON.parse del backend.
    JWT_PUBLIC_KEYS: `{"dev-1":"${publica}"}`,
    JWT_ACTIVE_KID: 'dev-1',
    PLATAFORMA_LLAVE_TOTP: llaveTotp,
    ENLACES_LLAVE: llaveEnlaces,
    ENLACES_SAL_IP: salEnlaces,
    INTENTOS_SAL_IP: salIntentos,
  };
}

/** Nombres de variables de un archivo .env, sin leer ni conservar sus valores. */
function nombres(texto) {
  const lista = [];
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(linea);
    if (m) lista.push(m[1]);
  }
  return lista;
}

function escribirAtomico(destino, contenido) {
  const temporal = `${destino}.${process.pid}.tmp`;
  const fd = openSync(temporal, 'wx', 0o600);
  try {
    writeSync(fd, contenido);
  } finally {
    closeSync(fd);
  }
  if (existsSync(destino)) {
    rmSync(temporal, { force: true });
    throw new Error('El archivo .env apareció mientras se generaba; no se tocó.');
  }
  renameSync(temporal, destino);
}

export function principal(argv = process.argv.slice(2), salida = console) {
  let opciones;
  try {
    opciones = argumentos(argv);
  } catch (error) {
    salida.error(error.message);
    return 1;
  }
  const dir = resolve(opciones.dir);
  const ejemplo = join(dir, '.env.example');
  const destino = join(dir, '.env');

  if (opciones.subred !== undefined && !subredValida(opciones.subred)) {
    salida.error('La subred debe tener la forma a.b.c (tres octetos de 0 a 255), por ejemplo 172.29.0.');
    return 1;
  }
  if (!existsSync(ejemplo)) {
    salida.error(`No se encontró .env.example en ${dir}.`);
    return 1;
  }
  const textoEjemplo = readFileSync(ejemplo, 'utf8');

  if (existsSync(destino)) {
    // Solo los nombres: el contenido se descarta en esta misma función y nunca se muestra.
    const presentes = new Set(nombres(readFileSync(destino, 'utf8')));
    const faltan = nombres(textoEjemplo).filter((n) => !presentes.has(n));
    if (opciones.subred !== undefined) {
      salida.log('El .env ya existe: --subred solo se aplica al crear uno nuevo; no se cambió nada.');
    }
    if (faltan.length === 0) {
      salida.log('El .env ya existe y no falta ninguna variable de .env.example. No se cambió nada.');
      return 0;
    }
    salida.log(
      'El .env ya existe y NO se modificó. Le faltan estas variables de .env.example (solo nombres):',
    );
    for (const n of faltan) salida.log(`  - ${n}`);
    salida.log('Agrégalas a mano con valores propios (ver los comentarios de .env.example).');
    return 2;
  }

  const valores = generar();
  if (opciones.subred !== undefined) {
    valores.RED_SUBRED = `${opciones.subred}.0/24`;
    for (const [nombre, sufijo] of Object.entries(SUFIJOS_IP))
      valores[nombre] = `${opciones.subred}.${sufijo}`;
  }
  const pendientes = new Set(Object.keys(valores));
  const lineas = textoEjemplo.split(/\r?\n/).map((linea) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(linea);
    if (!m || !pendientes.has(m[1])) return linea;
    pendientes.delete(m[1]);
    return `${m[1]}=${valores[m[1]]}`;
  });
  if (pendientes.size > 0) {
    lineas.push('', '# --- Agregadas por scripts/preparar-entorno (--subred) ---');
    for (const nombre of pendientes) lineas.push(`${nombre}=${valores[nombre]}`);
  }
  try {
    escribirAtomico(destino, `${lineas.join('\n').replace(/\n*$/, '')}\n`);
  } catch (error) {
    salida.error(error.message);
    return 1;
  }
  salida.log(`Se creó ${destino} a partir de .env.example. Valores SOLO para desarrollo:`);
  for (const nombre of [
    'JWT_PRIVATE_KEY',
    'JWT_PUBLIC_KEYS',
    'PLATAFORMA_LLAVE_TOTP',
    'ENLACES_LLAVE',
    'ENLACES_SAL_IP',
    'INTENTOS_SAL_IP',
  ]) {
    salida.log(`  - ${nombre}: generada`);
  }
  if (opciones.subred !== undefined) salida.log(`  - RED_SUBRED e IP fijas: ${opciones.subred}.0/24`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  process.exitCode = principal();
