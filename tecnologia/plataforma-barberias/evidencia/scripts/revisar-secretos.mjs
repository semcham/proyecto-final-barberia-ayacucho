#!/usr/bin/env node
// Funcionalidad 009 (research R01, análisis A6): busca en evidencia/ patrones de secretos antes de cada commit y en
// la CI. Nunca muestra el valor encontrado: solo el archivo, la línea y el nombre del patrón.
//
//   node evidencia/scripts/revisar-secretos.mjs [--raiz <carpeta>]   (por defecto, la carpeta evidencia/)
//
// Ignora evidencia/**/no-versionado/ (trazas y HTML de Playwright, fuera de git) y la propia carpeta scripts/.
// Código 0 sin hallazgos; 1 con alguno.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATRONES = [
  { nombre: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{8,}/ },
  { nombre: 'URI otpauth', regex: /otpauth:\/\//i },
  { nombre: 'cabecera Bearer', regex: /\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/ },
  { nombre: 'cabecera set-cookie', regex: /\bset-cookie\b/i },
  { nombre: 'bloque PEM', regex: /-----BEGIN [A-Z ]*-----/ },
  { nombre: 'token de GitHub', regex: /\b(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/ },
  { nombre: 'credencial del túnel', regex: /"(TunnelSecret|AccountTag)"/ },
];

const OMITIR = new Set(['no-versionado', 'scripts', 'node_modules']);
const LIMITE_BYTES = 50 * 1024 * 1024;

function* archivos(dir) {
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    if (entrada.isDirectory()) {
      if (!OMITIR.has(entrada.name)) yield* archivos(join(dir, entrada.name));
    } else if (entrada.isFile()) {
      yield join(dir, entrada.name);
    }
  }
}

/** @returns {{ archivo: string, linea: number, patron: string }[]} */
export function revisar(raiz) {
  const hallazgos = [];
  if (!existsSync(raiz)) return hallazgos;
  for (const archivo of archivos(raiz)) {
    if (statSync(archivo).size > LIMITE_BYTES) continue;
    const lineas = readFileSync(archivo, 'utf8').split(/\r?\n/);
    lineas.forEach((texto, i) => {
      for (const { nombre, regex } of PATRONES) {
        if (regex.test(texto))
          hallazgos.push({ archivo: relative(raiz, archivo), linea: i + 1, patron: nombre });
      }
    });
  }
  return hallazgos;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--raiz');
  const raiz = resolve(i > 0 ? process.argv[i + 1] : fileURLToPath(new URL('..', import.meta.url)));
  const hallazgos = revisar(raiz);
  if (hallazgos.length === 0) {
    console.log(`revisar-secretos: sin hallazgos en ${raiz}.`);
  } else {
    console.error(
      `revisar-secretos: ${hallazgos.length} hallazgo(s) en ${raiz} (no se muestran los valores):`,
    );
    for (const h of hallazgos) console.error(`  - ${h.archivo}:${h.linea}  ${h.patron}`);
    process.exitCode = 1;
  }
}
