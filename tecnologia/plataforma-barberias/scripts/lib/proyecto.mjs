#!/usr/bin/env node
// Funcionalidad 009 (research R01b, análisis C1): guardián del proyecto de Docker Compose.
// Todo script de 009 que llama a `docker compose` lo ejecuta primero. Exige COMPOSE_PROJECT_NAME y rechaza el
// proyecto por defecto del responsable (`plataforma-barberias`, el nombre de la carpeta), para que una medición o
// una verificación nunca use su .env ni su volumen por accidente.
//
// Como módulo:  import { exigirProyectoAparte } from './lib/proyecto.mjs'
// Como orden:   node scripts/lib/proyecto.mjs   → código 0 si el proyecto es otro, 6 si no.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROYECTO_DEL_RESPONSABLE = 'plataforma-barberias';
export const CODIGO_PROYECTO = 6;

/** @returns {{ ok: true, proyecto: string } | { ok: false, mensaje: string }} */
export function exigirProyectoAparte(entorno = process.env) {
  const proyecto = (entorno.COMPOSE_PROJECT_NAME ?? '').trim();
  if (proyecto === '') {
    return {
      ok: false,
      mensaje:
        'Falta COMPOSE_PROJECT_NAME. Los scripts de 009 nunca usan el proyecto por defecto: fija uno propio, por ' +
        'ejemplo COMPOSE_PROJECT_NAME=barberias-verificacion, en una copia con su propio .env y su propia subred.',
    };
  }
  if (proyecto.toLowerCase() === PROYECTO_DEL_RESPONSABLE) {
    return {
      ok: false,
      mensaje:
        `COMPOSE_PROJECT_NAME=${proyecto} es el proyecto de desarrollo del responsable: no se usa para medir ni ` +
        'verificar. Usa otro nombre, por ejemplo barberias-verificacion.',
    };
  }
  return { ok: true, proyecto };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = exigirProyectoAparte();
  if (!r.ok) {
    console.error(r.mensaje);
    process.exitCode = CODIGO_PROYECTO;
  }
}
