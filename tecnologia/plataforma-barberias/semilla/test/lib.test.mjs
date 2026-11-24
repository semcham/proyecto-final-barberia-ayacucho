// T018 de 009 · Bibliotecas de la semilla: fechas de atención, buzón de desarrollo, contraseñas al azar y reintento
// ante el límite de solicitudes (429). Sin red ni Docker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApi } from '../lib/api.mjs';
import { leerEnlace, leerTokenDeCuenta } from '../lib/buzon.mjs';
import { contrasenaAlAzar } from '../lib/contrasenas.mjs';
import { buscarCitaExistente, diaDeAtencion, horaLocal, inicioIso } from '../lib/idempotencia.mjs';

const LIMA = 'America/Lima';
const LUNES_A_SABADO = [1, 2, 3, 4, 5, 6].map((d) => ({ diaSemana: d, inicio: '09:00', fin: '19:00' }));

test('diaDeAtencion salta los días cerrados y empieza mañana (hora de Lima)', () => {
  // Sábado 2026-11-21 a las 23:30 en Lima (domingo 04:30 UTC): el primer día de atención es el lunes 23.
  const hoy = new Date('2026-11-22T04:30:00Z');
  assert.equal(diaDeAtencion(1, hoy, LUNES_A_SABADO, LIMA), '2026-11-23');
  assert.equal(diaDeAtencion(6, hoy, LUNES_A_SABADO, LIMA), '2026-11-28');
  assert.equal(diaDeAtencion(7, hoy, LUNES_A_SABADO, LIMA), '2026-11-30');
});

test('inicioIso usa el desfase de Lima y horaLocal lo lee de vuelta', () => {
  const inicio = inicioIso('2026-11-23', '09:00', LIMA);
  assert.equal(inicio, '2026-11-23T09:00:00-05:00');
  assert.equal(horaLocal('2026-11-23T14:00:00.000Z', LIMA), '09:00');
});

test('buscarCitaExistente compara barbero, servicio y hora local, en cualquier fecha', () => {
  const citas = [
    {
      barbero: 'Carlos Demo',
      servicio: 'Corte clásico',
      inicio: '2026-11-23T14:00:00Z',
      estado: 'CONFIRMADA',
    },
  ];
  assert.ok(
    buscarCitaExistente(citas, { barbero: 'Carlos Demo', servicio: 'Corte clásico', hora: '09:00' }, LIMA),
  );
  assert.equal(
    buscarCitaExistente(citas, { barbero: 'Luis Demo', servicio: 'Corte clásico', hora: '09:00' }, LIMA),
    undefined,
  );
  assert.equal(
    buscarCitaExistente(citas, { barbero: 'Carlos Demo', servicio: 'Corte clásico', hora: '10:00' }, LIMA),
    undefined,
  );
});

test('contrasenaAlAzar: 20 caracteres con mayúscula, minúscula y dígito, distintas entre sí', () => {
  const vistas = new Set();
  for (let i = 0; i < 50; i++) {
    const c = contrasenaAlAzar();
    assert.equal(c.length, 20);
    assert.match(c, /[A-Z]/);
    assert.match(c, /[a-z]/);
    assert.match(c, /[0-9]/);
    vistas.add(c);
  }
  assert.equal(vistas.size, 50);
});

test('leerEnlace devuelve el enlace con token del último correo, y falla claro si no llega', async () => {
  const falso = async (url) => {
    if (url.includes('/api/v1/search')) return Response.json({ messages: [{ ID: 'm1' }] });
    return Response.json({
      Text: 'Activa tu cuenta: http://localhost:5173/activar?token=abcdefghijklmnopqrstu gracias',
    });
  };
  assert.equal(
    await leerEnlace({ buzon: 'http://buzon', correo: 'x@ejemplo.test', fetch: falso }),
    'http://localhost:5173/activar?token=abcdefghijklmnopqrstu',
  );
  const vacio = async () => Response.json({ messages: [] });
  await assert.rejects(
    leerEnlace({
      buzon: 'http://buzon',
      correo: 'x@ejemplo.test',
      fetch: vacio,
      esperaMaximaMs: 50,
      intervaloMs: 10,
    }),
    /No llegó/,
  );
});

// T066 de 010: el enlace de la cuenta va en el fragmento (`/verificar#<token>`), no en `token=`.
test('leerTokenDeCuenta devuelve el token de /verificar#…, espera uno distinto y falla claro si no llega', async () => {
  let texto = 'Verifica tu correo: http://localhost:5173/verificar#AbC_def-0123456789abcdefg (24 horas)';
  const falso = async (url) => {
    if (url.includes('/api/v1/search')) {
      assert.match(decodeURIComponent(url), /query=to:x@ejemplo\.test/);
      return Response.json({ messages: [{ ID: 'm1' }] });
    }
    return Response.json({ Text: texto });
  };
  const opciones = { buzon: 'http://buzon/', correo: 'x@ejemplo.test', fetch: falso, intervaloMs: 10 };
  assert.equal(await leerTokenDeCuenta(opciones), 'AbC_def-0123456789abcdefg');
  // Con `distintoDe`, sigue esperando hasta que llegue otro token (el de un reenvío).
  setTimeout(() => {
    texto = 'http://localhost:5173/verificar#NUEVO0123456789abcdefghij';
  }, 30);
  assert.equal(
    await leerTokenDeCuenta({ ...opciones, distintoDe: 'AbC_def-0123456789abcdefg', esperaMaximaMs: 2000 }),
    'NUEVO0123456789abcdefghij',
  );
  // Un correo sin ese enlace (p. ej. el de activación) no sirve.
  texto = 'Activa tu cuenta: http://localhost:5173/activar?token=abcdefghijklmnopqrstu';
  await assert.rejects(leerTokenDeCuenta({ ...opciones, esperaMaximaMs: 50 }), /No llegó.*\/verificar/);
});

test('la API reintenta un 429 respetando Retry-After y no lo cuenta como error', async () => {
  let llamadas = 0;
  const esperas = [];
  const falso = async () => {
    llamadas++;
    return llamadas === 1
      ? new Response('{}', { status: 429, headers: { 'retry-after': '7' } })
      : Response.json({ ok: true });
  };
  const api = crearApi({ base: 'http://api', fetch: falso, espera: async (ms) => esperas.push(ms) });
  const r = await api.get('/algo');
  assert.equal(r.estado, 200);
  assert.deepEqual(esperas, [7000]);
});
