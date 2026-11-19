// 009 · Validación de docker-compose.yml en la CI: claves duplicadas en un mismo mapa (por ejemplo, un servicio
// definido dos veces) hacen fallar el trabajo `herramientas`. Sin dependencias ni Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clavesDuplicadas } from '../validar-compose.mjs';

const SCRIPT = fileURLToPath(new URL('../validar-compose.mjs', import.meta.url));
const COMPOSE = fileURLToPath(new URL('../../docker-compose.yml', import.meta.url));

test('el docker-compose.yml del proyecto no tiene claves duplicadas', () => {
  const r = spawnSync(process.execPath, [SCRIPT, COMPOSE], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('detecta un servicio definido dos veces, con su línea y columna', () => {
  const texto = [
    'services:',
    '  db:',
    '    image: postgres:16',
    '  semilla:',
    '    image: node:22',
    '  semilla:',
    '    image: node:22',
    'networks:',
    '  plataforma: {}',
  ].join('\n');
  assert.deepEqual(clavesDuplicadas(texto), [{ linea: 6, columna: 3, clave: 'semilla' }]);
});

test('la misma clave en mapas distintos no es un duplicado', () => {
  const texto = [
    'services:',
    '  a:',
    '    image: x',
    '    deploy:',
    '      resources:',
    '        limits:',
    '          memory: 1M',
    '  b:',
    '    image: x',
    '    deploy:',
    '      resources:',
    '        limits:',
    '          memory: 2M',
  ].join('\n');
  assert.deepEqual(clavesDuplicadas(texto), []);
});

test('cada elemento de una lista es un mapa propio; las cadenas con dos puntos no son claves', () => {
  const texto = [
    'x:',
    '  config:',
    '    - subnet: a',
    '      gateway: b',
    '    - subnet: c',
    '  ports:',
    '    - "5173:5173"',
    '    - ./semilla:/semilla:ro',
    '  test: ["CMD", "a:b"]',
  ].join('\n');
  assert.deepEqual(clavesDuplicadas(texto), []);
  const repetida = ['x:', '  config:', '    - subnet: a', '      subnet: b'].join('\n');
  assert.deepEqual(clavesDuplicadas(repetida), [{ linea: 4, columna: 7, clave: 'subnet' }]);
});

test('ignora comentarios y el contenido de los bloques literales (| y >)', () => {
  const texto = [
    'servicio:',
    '  # imagen: comentada',
    '  command: >',
    '    sh -c "a: b',
    '    a: b"',
    '  imagen: x',
  ].join('\n');
  assert.deepEqual(clavesDuplicadas(texto), []);
});

test('como orden: código 1 y la posición si hay duplicados', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validar-compose-'));
  try {
    const archivo = join(dir, 'docker-compose.yml');
    writeFileSync(archivo, 'services:\n  a:\n    image: x\n  a:\n    image: y\n');
    const r = spawnSync(process.execPath, [SCRIPT, archivo], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /línea 4, columna 3.*"a"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
