import { randomUUID } from 'node:crypto';
import {
  iniciarWhatsappDePrueba,
  type SimuladorDePrueba,
  TOKEN_CONTROL_WHATSAPP,
  TOKEN_WHATSAPP_PRUEBAS,
} from '../../helpers/whatsapp';

// T108 · Simulador de WhatsApp en proceso aparte (ADR-026; contracts/notification-channel.md §3; RF33). Se prueba
// por HTTP, como lo usan el adaptador y las demos: autenticación del envío y del control, idempotencia por
// Idempotency-Key, consulta de mensajes y los SIETE modos (normal, lento, caido, colgado, rechazar, limite,
// fallar_n). Todo es simulado: ningún número ni texto real.

jest.setTimeout(60_000);

const NUMERO = '+51 900 000 001';

describe('Simulador de WhatsApp (T108)', () => {
  let s: SimuladorDePrueba;

  const enviar = (
    opciones: { token?: string | null; clave?: string; para?: string; texto?: string; tiempo?: number } = {},
  ) => {
    const encabezados: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8' };
    if (opciones.token !== null)
      encabezados.Authorization = `Bearer ${opciones.token ?? TOKEN_WHATSAPP_PRUEBAS}`;
    encabezados['Idempotency-Key'] = opciones.clave ?? randomUUID();
    return fetch(`${s.url}/mensajes`, {
      method: 'POST',
      headers: encabezados,
      body: JSON.stringify({
        para: opciones.para ?? NUMERO,
        texto: opciones.texto ?? 'Hola, Ñusta: tu cita es a las 10:30.',
      }),
      signal: AbortSignal.timeout(opciones.tiempo ?? 5000),
    });
  };

  beforeAll(async () => {
    s = await iniciarWhatsappDePrueba();
  });

  beforeEach(async () => {
    await fetch(`${s.url}/control/reiniciar`, {
      method: 'POST',
      headers: { 'X-Control': TOKEN_CONTROL_WHATSAPP },
    });
  });

  afterAll(async () => {
    await s.cerrar();
  });

  it('autenticación: sin token o con otro token, 401 y no guarda nada; el control exige su propio token', async () => {
    expect((await enviar({ token: null })).status).toBe(401);
    expect((await enviar({ token: 'otro' })).status).toBe(401);
    expect(await s.mensajesPara(NUMERO)).toEqual([]);
    const sinControl = await fetch(`${s.url}/mensajes?para=${encodeURIComponent(NUMERO)}`);
    expect(sinControl.status).toBe(401);
    const conTokenDeEnvio = await fetch(`${s.url}/control/modo`, {
      method: 'POST',
      headers: { 'X-Control': TOKEN_WHATSAPP_PRUEBAS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo: 'caido' }),
    });
    expect(conTokenDeEnvio.status).toBe(401);
  });

  it('normal: acepta, responde { id } y el mensaje se consulta por número, con el texto exacto en UTF-8', async () => {
    const clave = randomUUID();
    const respuesta = await enviar({ clave });
    expect(respuesta.status).toBe(201);
    const { id } = (await respuesta.json()) as { id: string };
    expect(id).toMatch(/^wa_/);
    expect(await s.mensajesPara(NUMERO)).toEqual([
      expect.objectContaining({
        id,
        para: NUMERO,
        texto: 'Hola, Ñusta: tu cita es a las 10:30.',
        claveIdempotencia: clave,
        charsetUtf8: true,
      }),
    ]);
    expect(await s.mensajesPara('+51 900 000 999')).toEqual([]);
  });

  it('idempotencia: la misma Idempotency-Key devuelve el mismo id sin guardar otro mensaje; sin clave, 400', async () => {
    const clave = randomUUID();
    const primero = (await (await enviar({ clave })).json()) as { id: string };
    const segundo = await enviar({ clave });
    expect(segundo.status).toBe(200);
    expect(((await segundo.json()) as { id: string }).id).toBe(primero.id);
    expect(await s.mensajesPara(NUMERO)).toHaveLength(1);
    const sinClave = await fetch(`${s.url}/mensajes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN_WHATSAPP_PRUEBAS}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ para: NUMERO, texto: 'x' }),
    });
    expect(sinClave.status).toBe(400);
  });

  it('lento: responde pasado retardoMs', async () => {
    await s.modo({ modo: 'lento', retardoMs: 400 });
    const inicio = Date.now();
    expect((await enviar()).status).toBe(201);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(380);
  });

  it('caido: corta cada conexión (y cuenta los intentos); con duracionMs vuelve solo a normal', async () => {
    await s.modo({ modo: 'caido', duracionMs: 500 });
    const antes = s.simulador.conexiones();
    await expect(enviar()).rejects.toThrow();
    expect(s.simulador.conexiones()).toBeGreaterThan(antes);
    await new Promise((resolver) => setTimeout(resolver, 700));
    expect((await enviar()).status).toBe(201);
  });

  it('colgado: acepta la conexión y no responde', async () => {
    await s.modo({ modo: 'colgado' });
    await expect(enviar({ tiempo: 500 })).rejects.toThrow();
    await s.modo({ modo: 'normal' });
    expect((await enviar()).status).toBe(201);
  });

  it('rechazar: 400 (número inválido) y no guarda el mensaje', async () => {
    await s.modo({ modo: 'rechazar' });
    const respuesta = await enviar();
    expect(respuesta.status).toBe(400);
    expect(((await respuesta.json()) as { codigo: string }).codigo).toBe('NUMERO_INVALIDO');
    expect(await s.mensajesPara(NUMERO)).toEqual([]);
  });

  it('limite: 429 con Retry-After', async () => {
    await s.modo({ modo: 'limite' });
    const respuesta = await enviar();
    expect(respuesta.status).toBe(429);
    expect(respuesta.headers.get('retry-after')).toBeTruthy();
  });

  it('fallar_n: falla los N primeros envíos (503) y después acepta', async () => {
    await s.modo({ modo: 'fallar_n', veces: 2 });
    expect((await enviar()).status).toBe(503);
    expect((await enviar()).status).toBe(503);
    expect((await enviar()).status).toBe(201);
    expect(await s.mensajesPara(NUMERO)).toHaveLength(1);
  });

  it('un modo desconocido o con parámetros inválidos → 400; reiniciar borra los mensajes y vuelve a normal', async () => {
    const malo = await fetch(`${s.url}/control/modo`, {
      method: 'POST',
      headers: { 'X-Control': TOKEN_CONTROL_WHATSAPP, 'Content-Type': 'application/json' },
      body: JSON.stringify({ modo: 'explotar' }),
    });
    expect(malo.status).toBe(400);
    await enviar();
    await s.modo({ modo: 'limite' });
    await fetch(`${s.url}/control/reiniciar`, {
      method: 'POST',
      headers: { 'X-Control': TOKEN_CONTROL_WHATSAPP },
    });
    expect(await s.mensajesPara(NUMERO)).toEqual([]);
    expect((await enviar()).status).toBe(201);
  });
});
