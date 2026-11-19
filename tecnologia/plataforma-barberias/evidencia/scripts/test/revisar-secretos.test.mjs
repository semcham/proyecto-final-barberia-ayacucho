// T011 de 009 · revisar-secretos (research R01, análisis A6): busca en evidencia/ patrones de secretos antes de cada
// commit y en la CI. Los valores de prueba se arman por partes para que este archivo no contenga ninguno literal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../revisar-secretos.mjs', import.meta.url));

const J = 'ey' + 'J';
const CASOS = {
  jwt: `token ${J}hbGciOiJFUzI1NiJ9.${J}zdWIiOiIxIn0.abcdefghijklmnop`,
  otpauth: 'uri ' + 'otp' + 'auth://totp/Plataforma:admin?secret=ABCDEFGH',
  bearer: 'Authorization: ' + 'Bea' + 'rer abcdef123456',
  setCookie: 'Set-' + 'Cookie: rt=abc; HttpOnly',
  pem: '-----' + 'BEGIN PRIVATE KEY-----',
  ghp: 'gh' + 'p_' + 'a'.repeat(36),
  githubPat: 'github' + '_pat_' + 'b'.repeat(40),
  tunelSecreto: '{"Tunnel' + 'Secret":"xyz"}',
  tunelCuenta: '{"Account' + 'Tag":"xyz"}',
};

function revisar(raiz) {
  const r = spawnSync(process.execPath, [SCRIPT, '--raiz', raiz], { encoding: 'utf8' });
  return { codigo: r.status, salida: `${r.stdout}${r.stderr}` };
}

test('detecta cada patrón, muestra la ruta y el patrón, y nunca el valor encontrado', () => {
  for (const [nombre, contenido] of Object.entries(CASOS)) {
    const raiz = mkdtempSync(join(tmpdir(), 'revisar-secretos-'));
    try {
      mkdirSync(join(raiz, 'carga', 'x'), { recursive: true });
      writeFileSync(join(raiz, 'carga', 'x', 'crudo.json'), contenido);
      const { codigo, salida } = revisar(raiz);
      assert.equal(codigo, 1, nombre);
      assert.match(salida, /crudo\.json/, nombre);
      assert.ok(!salida.includes(contenido), `${nombre}: no muestra el valor`);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  }
});

test('ignora evidencia/**/no-versionado/', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'revisar-secretos-'));
  try {
    mkdirSync(join(raiz, 'e2e', 'no-versionado', 'traza'), { recursive: true });
    writeFileSync(join(raiz, 'e2e', 'no-versionado', 'traza', 'red.json'), CASOS.bearer);
    assert.equal(revisar(raiz).codigo, 0);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('sin hallazgos devuelve 0, también con una carpeta vacía o inexistente', () => {
  const raiz = mkdtempSync(join(tmpdir(), 'revisar-secretos-'));
  try {
    mkdirSync(join(raiz, 'carga'), { recursive: true });
    writeFileSync(join(raiz, 'carga', 'resumen.md'), '# Resumen\n\np95 = 412 ms, cumple.\n');
    assert.equal(revisar(raiz).codigo, 0);
    assert.equal(revisar(join(raiz, 'no-existe')).codigo, 0);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
