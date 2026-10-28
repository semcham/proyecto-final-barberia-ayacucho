import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { iniciarSimulador, type Simulador } from '../../../simulador-pagos/servidor';

// T014 · Simulador de la pasarela (research R02; contracts/pasarela-simulada.md §2 a §4): cada modo contra
// el simulador iniciado dentro del proceso, con un receptor de notificaciones propio de la prueba. Las rutas
// /control/* exigen X-Control y la API /v1, la llave secreta.

const LLAVE = 'sk_prueba_simulador';
const SECRETO = 'whsec_prueba_simulador_0123456789';
const CONTROL = 'control_prueba';

interface Notificacion {
  encabezados: IncomingHttpHeaders;
  cuerpo: string;
  json: Record<string, unknown>;
}

/** Receptor de notificaciones: guarda lo recibido y responde con los códigos indicados (200 por defecto). */
async function iniciarReceptor(): Promise<{
  url: string;
  recibidas: Notificacion[];
  responderCon: (codigos: number[]) => void;
  cerrar: () => Promise<void>;
}> {
  const recibidas: Notificacion[] = [];
  let codigos: number[] = [];
  const servidor: Server = createServer((solicitud, respuesta) => {
    const partes: Buffer[] = [];
    solicitud.on('data', (p: Buffer) => partes.push(p));
    solicitud.on('end', () => {
      const cuerpo = Buffer.concat(partes).toString('utf8');
      recibidas.push({ encabezados: solicitud.headers, cuerpo, json: JSON.parse(cuerpo) });
      respuesta.writeHead(codigos.shift() ?? 200).end();
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/notificaciones`,
    recibidas,
    responderCon: (lista) => (codigos = [...lista]),
    cerrar: () => new Promise((r) => servidor.close(() => r())),
  };
}

function firmaValida(n: Notificacion): boolean {
  const encabezado = String(n.encabezados['x-firma'] ?? '');
  const t = /t=(\d+)/.exec(encabezado)?.[1];
  const v1 = /v1=([0-9a-f]+)/.exec(encabezado)?.[1];
  if (!t || !v1) return false;
  return createHmac('sha256', SECRETO).update(`${t}.${n.cuerpo}`).digest('hex') === v1;
}

describe('Simulador de la pasarela (T014)', () => {
  let simulador: Simulador;
  let receptor: Awaited<ReturnType<typeof iniciarReceptor>>;

  const api = (ruta: string, init: RequestInit = {}) =>
    fetch(`${simulador.url}${ruta}`, {
      ...init,
      headers: { Authorization: `Bearer ${LLAVE}`, 'Content-Type': 'application/json', ...init.headers },
    });
  const controlar = (ruta: string, cuerpo: unknown = {}) =>
    fetch(`${simulador.url}${ruta}`, {
      method: 'POST',
      headers: { 'X-Control': CONTROL, 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });

  async function crearSesion(
    importe = 4900,
  ): Promise<{ referencia: string; url_pago: string; expira_en: string }> {
    const respuesta = await api('/v1/sesiones', {
      method: 'POST',
      body: JSON.stringify({
        pago_id: 'pago-1',
        importe_centimos: importe,
        moneda: 'PEN',
        descripcion: 'Plan Básico',
        metodo: 'YAPE',
        url_retorno: 'http://localhost:5173/app/suscripcion',
      }),
    });
    expect(respuesta.status).toBe(201);
    return (await respuesta.json()) as { referencia: string; url_pago: string; expira_en: string };
  }

  async function estadoDe(referencia: string): Promise<string> {
    return ((await (await api(`/v1/sesiones/${referencia}`)).json()) as { estado: string }).estado;
  }

  beforeAll(async () => {
    receptor = await iniciarReceptor();
    simulador = await iniciarSimulador({
      puerto: 0,
      secretoFirma: SECRETO,
      llaveSecreta: LLAVE,
      tokenControl: CONTROL,
      urlNotificaciones: receptor.url,
      esperaReintentoMs: 20,
    });
  });

  afterEach(async () => {
    await simulador.reiniciar();
    await simulador.esperarNotificaciones();
    receptor.recibidas.length = 0;
    receptor.responderCon([]);
  });

  afterAll(async () => {
    await simulador.cerrar();
    await receptor.cerrar();
  });

  describe('autenticación', () => {
    it('la API /v1 exige la llave secreta', async () => {
      const respuesta = await fetch(`${simulador.url}/v1/sesiones/ses_x`);
      expect(respuesta.status).toBe(401);
      const otra = await fetch(`${simulador.url}/v1/sesiones/ses_x`, {
        headers: { Authorization: 'Bearer otra' },
      });
      expect(otra.status).toBe(401);
    });

    it.each(['/control/modo', '/control/reiniciar', '/control/sesiones/ses_x/aprobar'])(
      '%s exige X-Control',
      async (ruta) => {
        const sin = await fetch(`${simulador.url}${ruta}`, { method: 'POST', body: '{"modo":"caido"}' });
        expect(sin.status).toBe(401);
        const otro = await fetch(`${simulador.url}${ruta}`, {
          method: 'POST',
          headers: { 'X-Control': 'otro' },
          body: '{"modo":"caido"}',
        });
        expect(otro.status).toBe(401);
      },
    );

    it('un modo desconocido se rechaza', async () => {
      expect((await controlar('/control/modo', { modo: 'explotar' })).status).toBe(400);
    });
  });

  describe('modo normal', () => {
    it('crea, consulta, decide y notifica una vez con firma HMAC-SHA256 válida', async () => {
      const sesion = await crearSesion();
      expect(sesion.referencia).toMatch(/^ses_/);
      expect(new Date(sesion.expira_en).getTime()).toBeGreaterThan(Date.now() + 29 * 60 * 1000);
      expect(await estadoDe(sesion.referencia)).toBe('PENDIENTE');
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      expect(await estadoDe(sesion.referencia)).toBe('APROBADO');
      expect(receptor.recibidas).toHaveLength(1);
      const [n] = receptor.recibidas;
      expect(firmaValida(n)).toBe(true);
      expect(n.json).toEqual({
        evento_id: expect.stringMatching(/^evt_/),
        tipo: 'pago.actualizado',
        referencia: sesion.referencia,
        estado: 'APROBADO',
        importe_centimos: 4900,
        moneda: 'PEN',
        emitido_en: expect.any(String),
      });
    });

    it('rechaza importes fuera de los límites de Yape', async () => {
      const respuesta = await api('/v1/sesiones', {
        method: 'POST',
        body: JSON.stringify({
          pago_id: 'p',
          importe_centimos: 500,
          moneda: 'PEN',
          metodo: 'YAPE',
          url_retorno: 'http://localhost',
        }),
      });
      expect(respuesta.status).toBe(422);
    });

    it('cancela una sesión pendiente, y una cancelada ya no se puede aprobar', async () => {
      const sesion = await crearSesion();
      const cancelada = await (
        await api(`/v1/sesiones/${sesion.referencia}/cancelar`, { method: 'POST' })
      ).json();
      expect(cancelada).toEqual({ cancelada: true });
      expect(await estadoDe(sesion.referencia)).toBe('EXPIRADO');
      expect((await controlar(`/control/sesiones/${sesion.referencia}/aprobar`)).status).toBe(409);
    });

    it('reintenta la notificación mientras la plataforma no responde 2xx', async () => {
      receptor.responderCon([500, 503]);
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas).toHaveLength(3);
      expect(new Set(receptor.recibidas.map((n) => n.json.evento_id)).size).toBe(1);
    });

    it('una decisión sin notificación (para la conciliación)', async () => {
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`, { notificar: false });
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas).toHaveLength(0);
      expect(await estadoDe(sesion.referencia)).toBe('APROBADO');
    });

    it('registra las solicitudes de la API', async () => {
      const sesion = await crearSesion();
      await estadoDe(sesion.referencia);
      expect(simulador.solicitudes().map((s) => `${s.metodo} ${s.ruta}`)).toEqual([
        'POST /v1/sesiones',
        `GET /v1/sesiones/${sesion.referencia}`,
      ]);
    });

    it('la página alojada muestra el importe y al decidir vuelve a la plataforma con el pago', async () => {
      const sesion = await crearSesion();
      const pagina = await (await fetch(sesion.url_pago)).text();
      expect(pagina).toContain('S/ 49,00');
      const decision = await fetch(`${sesion.url_pago}/aprobar`, { method: 'POST', redirect: 'manual' });
      expect(decision.status).toBe(303);
      expect(decision.headers.get('location')).toBe('http://localhost:5173/app/suscripcion?pago=pago-1');
      expect(await estadoDe(sesion.referencia)).toBe('APROBADO');
    });
  });

  describe('modos de fallo (§3)', () => {
    it('lento: demora la respuesta de la API', async () => {
      await simulador.cambiarModo({ modo: 'lento', retardoMs: 300 });
      const inicio = Date.now();
      await crearSesion();
      expect(Date.now() - inicio).toBeGreaterThanOrEqual(290);
    });

    it('caido: cierra el puerto (conexión rechazada) hasta volver a normal', async () => {
      await simulador.cambiarModo({ modo: 'caido' });
      // La primera solicitud puede reutilizar una conexión que el cierre acaba de cortar (ECONNRESET); las
      // siguientes ya no encuentran el puerto (ECONNREFUSED).
      await fetch(`${simulador.url}/v1/sesiones/x`).catch(() => undefined);
      const error = await fetch(`${simulador.url}/v1/sesiones/x`).catch((e: Error) => e);
      // fetch lanza un TypeError de otro realm (undici): se compara por nombre, no con instanceof.
      expect((error as Error).name).toBe('TypeError');
      expect(((error as Error & { cause?: { code?: string } }).cause ?? {}).code).toBe('ECONNREFUSED');
      await simulador.cambiarModo({ modo: 'normal' });
      expect((await api('/v1/sesiones/x')).status).toBe(404);
    });

    it('caido por HTTP con duración: vuelve solo', async () => {
      await controlar('/control/modo', { modo: 'caido', duracionMs: 200 });
      await new Promise((r) => setTimeout(r, 50));
      await expect(fetch(`${simulador.url}/salud`)).rejects.toThrow();
      await new Promise((r) => setTimeout(r, 400));
      expect((await fetch(`${simulador.url}/salud`)).status).toBe(200);
    });

    it('colgado: acepta la conexión y no responde', async () => {
      await simulador.cambiarModo({ modo: 'colgado' });
      const inicio = Date.now();
      await expect(api('/v1/sesiones/x', { signal: AbortSignal.timeout(300) })).rejects.toThrow();
      expect(Date.now() - inicio).toBeGreaterThanOrEqual(290);
    });

    it('duplicar: la misma notificación N veces, con el mismo evento_id', async () => {
      await simulador.cambiarModo({ modo: 'duplicar', veces: 3 });
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas).toHaveLength(3);
      expect(new Set(receptor.recibidas.map((n) => n.cuerpo)).size).toBe(1);
      expect(receptor.recibidas.every(firmaValida)).toBe(true);
    });

    it('firma_invalida: firma con otro secreto', async () => {
      await simulador.cambiarModo({ modo: 'firma_invalida' });
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas[0].encabezados['x-firma']).toBeDefined();
      expect(firmaValida(receptor.recibidas[0])).toBe(false);
    });

    it('sin_firma: notifica sin el encabezado', async () => {
      await simulador.cambiarModo({ modo: 'sin_firma' });
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas[0].encabezados['x-firma']).toBeUndefined();
    });

    it('fuera_de_orden: APROBADO y luego un PENDIENTE atrasado', async () => {
      await simulador.cambiarModo({ modo: 'fuera_de_orden' });
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      const [aprobado, pendiente] = receptor.recibidas.map((n) => n.json);
      expect([aprobado.estado, pendiente.estado]).toEqual(['APROBADO', 'PENDIENTE']);
      expect(pendiente.evento_id).not.toBe(aprobado.evento_id);
      expect(Date.parse(String(pendiente.emitido_en))).toBeLessThan(Date.parse(String(aprobado.emitido_en)));
    });

    it('importe_distinto: notifica un importe distinto del de la sesión', async () => {
      await simulador.cambiarModo({ modo: 'importe_distinto' });
      const sesion = await crearSesion(4900);
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas[0].json.importe_centimos).not.toBe(4900);
    });

    it('aprobar_despues: aprueba tras el retardo aunque la plataforma ya la haya cancelado', async () => {
      await simulador.cambiarModo({ modo: 'aprobar_despues', retardoMs: 200 });
      const sesion = await crearSesion();
      const cancelada = await (
        await api(`/v1/sesiones/${sesion.referencia}/cancelar`, { method: 'POST' })
      ).json();
      expect(cancelada).toEqual({ cancelada: false });
      expect(await estadoDe(sesion.referencia)).toBe('PENDIENTE');
      await new Promise((r) => setTimeout(r, 350));
      await simulador.esperarNotificaciones();
      expect(await estadoDe(sesion.referencia)).toBe('APROBADO');
      expect(receptor.recibidas.map((n) => n.json.estado)).toEqual(['APROBADO']);
    });

    it('rechazar: toda sesión se rechaza y se notifica', async () => {
      await simulador.cambiarModo({ modo: 'rechazar' });
      const sesion = await crearSesion();
      await new Promise((r) => setImmediate(r));
      await simulador.esperarNotificaciones();
      expect(await estadoDe(sesion.referencia)).toBe('RECHAZADO');
      expect(receptor.recibidas.map((n) => n.json.estado)).toEqual(['RECHAZADO']);
    });

    it('devolución: notifica DEVUELTO de una sesión aprobada', async () => {
      const sesion = await crearSesion();
      await controlar(`/control/sesiones/${sesion.referencia}/aprobar`);
      expect((await controlar(`/control/sesiones/${sesion.referencia}/devolver`)).status).toBe(200);
      await simulador.esperarNotificaciones();
      expect(receptor.recibidas.map((n) => n.json.estado)).toEqual(['APROBADO', 'DEVUELTO']);
      expect((await controlar(`/control/sesiones/${sesion.referencia}/devolver`)).status).toBe(409);
    });

    it('reiniciar vacía las sesiones y vuelve a normal', async () => {
      const sesion = await crearSesion();
      await simulador.cambiarModo({ modo: 'lento', retardoMs: 1 });
      await controlar('/control/reiniciar');
      expect((await api(`/v1/sesiones/${sesion.referencia}`)).status).toBe(404);
      const salud = await (await fetch(`${simulador.url}/salud`)).json();
      expect(salud).toEqual({ estado: 'ok', modo: 'normal' });
    });
  });
});
