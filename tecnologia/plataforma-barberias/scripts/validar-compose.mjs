#!/usr/bin/env node
// 009 · Detecta claves duplicadas en un mismo mapa de un YAML en estilo de bloque, como docker-compose.yml (por
// ejemplo, un servicio definido dos veces: "Map keys must be unique"). Sin dependencias, para el trabajo
// `herramientas` de la CI, que además ejecuta `docker compose config -q` con un .env creado desde .env.example.
//
//   node scripts/validar-compose.mjs [docker-compose.yml]   → código 0 sin duplicados; 1 con alguno o si falta.
//
// Alcance: mapas en estilo de bloque y elementos de lista (`- clave: valor`). Ignora comentarios, el contenido de
// los bloques literales (`|` y `>`) y las colecciones en línea (`[...]`, `{...}`), que docker compose valida aparte.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Clave al inicio de la línea (tras la sangría y un posible "- "): sin comillas, o entre comillas simples o dobles,
// seguida de ":" y un espacio o el fin de la línea.
const CLAVE = /^(\s*)(-\s+)?(?:"([^"]+)"|'([^']+)'|([^\s"'#\-[{][^:#]*?|<<))\s*:(?:\s|$)/;
const SOLO_GUION = /^(\s*)-\s*(#.*)?$/;
const BLOQUE_LITERAL = /:\s*[|>][-+0-9]*\s*(#.*)?$/;

/** @returns {{ linea: number, columna: number, clave: string }[]} */
export function clavesDuplicadas(texto) {
  const duplicados = [];
  /** @type {{ sangria: number, claves: Map<string, number> }[]} */
  const ambitos = [];
  let bloqueHasta = -1; // sangría del bloque literal en curso; sus líneas más sangradas se ignoran

  const lineas = texto.split(/\r?\n/);
  lineas.forEach((linea, i) => {
    if (/^\s*(#.*)?$/.test(linea)) return;
    const sangriaLinea = linea.length - linea.trimStart().length;
    if (bloqueHasta >= 0) {
      if (sangriaLinea > bloqueHasta) return;
      bloqueHasta = -1;
    }

    const guion = SOLO_GUION.exec(linea);
    if (guion) {
      // Un "-" solo: el mapa del elemento empieza en la línea siguiente; cierra los ámbitos más sangrados.
      while (ambitos.length && ambitos.at(-1).sangria > guion[1].length) ambitos.pop();
      return;
    }

    const m = CLAVE.exec(linea);
    if (!m) {
      if (/^\s*-\s/.test(linea)) {
        // Elemento de lista que no es un mapa (un valor): cierra los ámbitos del elemento anterior.
        while (ambitos.length && ambitos.at(-1).sangria > sangriaLinea) ambitos.pop();
      }
      return;
    }
    const clave = (m[3] ?? m[4] ?? m[5]).trim();
    const esElemento = Boolean(m[2]);
    const sangria = m[1].length + (m[2]?.length ?? 0);

    if (esElemento) {
      // Cada elemento de una lista es un mapa nuevo: cierra todo ámbito igual o más sangrado que su contenido.
      while (ambitos.length && ambitos.at(-1).sangria >= sangria) ambitos.pop();
      ambitos.push({ sangria, claves: new Map() });
    } else {
      while (ambitos.length && ambitos.at(-1).sangria > sangria) ambitos.pop();
      if (!ambitos.length || ambitos.at(-1).sangria < sangria) ambitos.push({ sangria, claves: new Map() });
    }

    const ambito = ambitos.at(-1);
    if (ambito.claves.has(clave)) duplicados.push({ linea: i + 1, columna: sangria + 1, clave });
    else ambito.claves.set(clave, i + 1);

    if (BLOQUE_LITERAL.test(linea)) bloqueHasta = sangria;
  });
  return duplicados;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const archivo = resolve(process.argv[2] ?? 'docker-compose.yml');
  if (!existsSync(archivo)) {
    console.error(`No existe ${archivo}.`);
    process.exitCode = 1;
  } else {
    const duplicados = clavesDuplicadas(readFileSync(archivo, 'utf8'));
    if (duplicados.length === 0) {
      console.log(`validar-compose: ${archivo} sin claves duplicadas.`);
    } else {
      for (const d of duplicados) {
        console.error(
          `validar-compose: ${archivo}, línea ${d.linea}, columna ${d.columna}: clave repetida "${d.clave}".`,
        );
      }
      process.exitCode = 1;
    }
  }
}
