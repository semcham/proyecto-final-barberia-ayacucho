// T009 de 009 · Guardián del proyecto de Compose (research R01b): ningún script de 009 que llame a
// `docker compose` puede actuar sobre el proyecto por defecto del responsable (`plataforma-barberias`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { exigirProyectoAparte, PROYECTO_DEL_RESPONSABLE, CODIGO_PROYECTO } from '../lib/proyecto.mjs';

const CLI = fileURLToPath(new URL('../lib/proyecto.mjs', import.meta.url));
const SH = fileURLToPath(new URL('../lib/proyecto.sh', import.meta.url));
const PS1 = fileURLToPath(new URL('../lib/proyecto.ps1', import.meta.url));

function conProyecto(valor) {
  const entorno = { ...process.env };
  delete entorno.COMPOSE_PROJECT_NAME;
  if (valor !== undefined) entorno.COMPOSE_PROJECT_NAME = valor;
  return entorno;
}

test('el proyecto del responsable es plataforma-barberias y el código es 6', () => {
  assert.equal(PROYECTO_DEL_RESPONSABLE, 'plataforma-barberias');
  assert.equal(CODIGO_PROYECTO, 6);
});

test('vacío, ausente o el del responsable: se rechaza con un mensaje que explica cómo fijarlo', () => {
  for (const valor of [undefined, '', '  ', 'plataforma-barberias', 'Plataforma-Barberias']) {
    const r = exigirProyectoAparte(conProyecto(valor));
    assert.equal(r.ok, false, String(valor));
    assert.match(r.mensaje, /COMPOSE_PROJECT_NAME/);
  }
});

test('otro nombre se acepta', () => {
  const r = exigirProyectoAparte(conProyecto('barberias-verificacion'));
  assert.equal(r.ok, true);
  assert.equal(r.proyecto, 'barberias-verificacion');
});

test('como orden: código 6 con el proyecto del responsable y 0 con otro', () => {
  const malo = spawnSync(process.execPath, [CLI], {
    env: conProyecto('plataforma-barberias'),
    encoding: 'utf8',
  });
  assert.equal(malo.status, 6);
  assert.match(malo.stderr, /COMPOSE_PROJECT_NAME/);
  const vacio = spawnSync(process.execPath, [CLI], { env: conProyecto(undefined), encoding: 'utf8' });
  assert.equal(vacio.status, 6);
  const bueno = spawnSync(process.execPath, [CLI], {
    env: conProyecto('barberias-verificacion'),
    encoding: 'utf8',
  });
  assert.equal(bueno.status, 0);
});

function hay(comando, args) {
  const r = spawnSync(comando, args, { encoding: 'utf8' });
  return r.status === 0;
}

test('el envoltorio de bash devuelve lo mismo que el .mjs', { skip: !hay('bash', ['-c', 'exit 0']) }, () => {
  const malo = spawnSync('bash', [SH], { env: conProyecto('plataforma-barberias'), encoding: 'utf8' });
  assert.equal(malo.status, 6);
  const bueno = spawnSync('bash', [SH], { env: conProyecto('barberias-verificacion'), encoding: 'utf8' });
  assert.equal(bueno.status, 0);
});

const POWERSHELL = process.platform === 'win32' ? 'powershell' : 'pwsh';
test(
  'el envoltorio de PowerShell devuelve lo mismo que el .mjs',
  { skip: !hay(POWERSHELL, ['-NoProfile', '-Command', 'exit 0']) },
  () => {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1];
    const malo = spawnSync(POWERSHELL, args, { env: conProyecto('plataforma-barberias'), encoding: 'utf8' });
    assert.equal(malo.status, 6);
    const bueno = spawnSync(POWERSHELL, args, {
      env: conProyecto('barberias-verificacion'),
      encoding: 'utf8',
    });
    assert.equal(bueno.status, 0);
  },
);
