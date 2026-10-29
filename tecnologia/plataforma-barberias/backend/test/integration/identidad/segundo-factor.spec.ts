import { Controller, Get, Logger } from '@nestjs/common';
import type { TestingModuleBuilder } from '@nestjs/testing';
import type { ActorPlataforma } from '../../../src/modules/acceso-barberias';
import { TotpNode } from '../../../src/modules/acceso-barberias/identidad/infrastructure/totp-node';
import { AdminActual, Plataforma } from '../../../src/host/solicitud';
import { Clock, Configuracion } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type AdminSembrado,
  codigoPara,
  RelojDePrueba,
  sembrarAdminPlataforma,
} from '../../helpers/plataforma';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T064 · Ingreso del administrador con segundo factor (R07, ADR-031): desafío, TOTP, códigos de un solo uso
// (también entre réplicas y con ingresos simultáneos), bloqueo de 5 fallos en 15 minutos, renovación, salida,
// platform_audit_log, el token sin acceso a las rutas de barbería y canarios (SC-010, M7).

@Controller('__prueba-admin')
class RutaDelAdmin {
  @Plataforma()
  @Get()
  yo(@AdminActual() admin: ActorPlataforma) {
    return admin;
  }
}

const RUTA_ADMIN = '/api/v1/__prueba-admin';
const NO_AUTENTICADO = {
  codigo: 'NO_AUTENTICADO',
  mensaje: 'Los datos de ingreso no son correctos o el código ya no es válido.',
  detalles: [],
};
const seed = () => poolDe('seed');

function reclamaciones(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

function cookieDe(respuesta: { headers: Record<string, unknown> }): string | undefined {
  return ([] as string[])
    .concat((respuesta.headers['set-cookie'] as string[]) ?? [])
    .find((c) => c.startsWith('rtp='));
}

describe('Ingreso del administrador con segundo factor (T064)', () => {
  const reloj = new RelojDePrueba();
  let a: AppDePrueba;
  let b: AppDePrueba;
  /** Todo lo que la aplicación escribió en registros durante la prueba (canarios). */
  let registros = '';
  /** Cuerpos de todas las respuestas de error de la prueba (canarios). */
  const errores: string[] = [];
  const restaurar: (() => void)[] = [];
  /** Secretos de todos los administradores de la prueba: no deben aparecer en ningún lado. */
  const canarios: string[] = [];

  function capturar(objeto: Record<string, unknown>, metodo: string) {
    const original = objeto[metodo] as (...args: unknown[]) => unknown;
    objeto[metodo] = (...args: unknown[]) => {
      registros += `${args.map((x) => (typeof x === 'string' ? x : (JSON.stringify(x) ?? String(x)))).join(' ')}\n`;
      return original.apply(objeto, args);
    };
    restaurar.push(() => {
      objeto[metodo] = original;
    });
  }

  const app = (prueba: AppDePrueba) => {
    // La aserción nunca falla: solo guarda el cuerpo de cada error para los canarios.
    const enviar = (ruta: string, cuerpo: object) =>
      prueba.agente
        .post(`/api/v1/plataforma/auth/${ruta}`)
        .send(cuerpo)
        .expect((r) => {
          if (r.status >= 400) errores.push(JSON.stringify(r.body));
        });
    return {
      ingresar: (correo: string, contrasena: string) => enviar('ingresar', { correo, contrasena }),
      segundoFactor: (cuerpo: object) => enviar('segundo-factor', cuerpo),
    };
  };

  async function admin(opciones: Parameters<typeof sembrarAdminPlataforma>[0] = {}): Promise<AdminSembrado> {
    const nuevo = await sembrarAdminPlataforma(opciones);
    const totp = new TotpNode(new Configuracion());
    canarios.push(
      nuevo.contrasena,
      nuevo.secreto.toString('hex'),
      nuevo.secreto.toString('base64'),
      new URL(totp.uri(nuevo.secreto, nuevo.correo)).searchParams.get('secret') as string,
      totp.uri(nuevo.secreto, nuevo.correo),
      ...nuevo.codigosRecuperacion,
      ...nuevo.codigosRecuperacion.map((c) => c.replace(/-/g, '')),
    );
    return nuevo;
  }

  async function desafio(prueba: AppDePrueba, ad: AdminSembrado): Promise<string> {
    const r = await app(prueba).ingresar(ad.correo, ad.contrasena).expect(200);
    return r.body.desafio;
  }

  /** Ingreso completo en el paso actual del reloj. */
  async function ingresoCompleto(prueba: AppDePrueba, ad: AdminSembrado) {
    const d = await desafio(prueba, ad);
    return app(prueba).segundoFactor({ desafio: d, codigo: codigoPara(ad.secreto, reloj.ahora()) });
  }

  const auditoria = async (adminId: string) =>
    (
      await seed().query(
        'SELECT action, result, ip FROM platform_audit_log WHERE admin_id = $1 ORDER BY at, id',
        [adminId],
      )
    ).rows as { action: string; result: string; ip: string | null }[];

  beforeAll(async () => {
    const ajustar = (c: TestingModuleBuilder) => c.overrideProvider(Clock).useValue(reloj);
    a = await crearApp({
      controladoresExtra: [RutaDelAdmin],
      ajustar,
      entorno: { INSTANCIA_ID: 'replica-a' },
    });
    b = await crearApp({
      controladoresExtra: [RutaDelAdmin],
      ajustar,
      entorno: { INSTANCIA_ID: 'replica-b' },
    });
    for (const p of [a, b]) p.app.useLogger(['log', 'error', 'warn', 'debug', 'verbose']);
    for (const metodo of ['log', 'warn', 'error', 'debug', 'verbose']) {
      capturar(Logger.prototype as never, metodo);
    }
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug']) capturar(console as never, metodo);
    capturar(process.stdout as never, 'write');
    capturar(process.stderr as never, 'write');
  });

  afterAll(async () => {
    restaurar.reverse().forEach((deshacer) => deshacer());
    await a.cerrar();
    await b.cerrar();
    await cerrarPools();
  });

  beforeEach(() => reloj.siguientePaso());

  describe('primer paso', () => {
    it('correo y contraseña correctos devuelven un desafío de 5 minutos, sin sesión todavía', async () => {
      const ad = await admin();
      const r = await app(a).ingresar(` ${ad.correo.toUpperCase()} `, ad.contrasena).expect(200);
      expect(Object.keys(r.body).sort()).toEqual(['desafio', 'expiraEn']);
      expect(r.body.desafio).toMatch(/^[0-9a-f-]{36}$/);
      expect(Date.parse(r.body.expiraEn) - reloj.ahora().getTime()).toBe(5 * 60 * 1000);
      expect(cookieDe(r)).toBeUndefined();
      const { rows } = await seed().query(
        'SELECT count(*)::int AS n FROM platform_session WHERE admin_id = $1',
        [ad.adminId],
      );
      expect(rows[0].n).toBe(0);
    });

    it('contraseña incorrecta, correo inexistente y cuenta desactivada responden el mismo 401', async () => {
      const ad = await admin();
      const desactivada = await admin({ estado: 'DESACTIVADA' });
      const respuestas = await Promise.all([
        app(a).ingresar(ad.correo, 'otra-clave'),
        app(a).ingresar('nadie@plataforma.prueba', 'otra-clave'),
        app(a).ingresar(desactivada.correo, desactivada.contrasena),
      ]);
      for (const r of respuestas)
        expect({ estado: r.status, cuerpo: r.body }).toEqual({ estado: 401, cuerpo: NO_AUTENTICADO });
    });
  });

  describe('segundo paso', () => {
    it('el TOTP correcto da el token de plataforma (aud "plataforma", sin tid) y la cookie de su ruta', async () => {
      const ad = await admin();
      const r = await ingresoCompleto(a, ad);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(['expiraEn', 'tipo', 'tokenAcceso']);
      expect(r.body.tipo).toBe('Bearer');
      expect(Date.parse(r.body.expiraEn) - reloj.ahora().getTime()).toBe(10 * 60 * 1000);
      const token = reclamaciones(r.body.tokenAcceso);
      expect(token).toMatchObject({ aud: 'plataforma', sub: ad.adminId, rol: 'ADMIN_PLATAFORMA' });
      expect(token).not.toHaveProperty('tid');

      const cookie = cookieDe(r) as string;
      expect(cookie).toMatch(/Path=\/api\/v1\/plataforma\/auth/);
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Secure/);
      expect(cookie).toMatch(/SameSite=Strict/);
      const maxAge = Number(/Max-Age=(\d+)/.exec(cookie)?.[1]);
      expect(maxAge).toBeLessThanOrEqual(8 * 60 * 60);
      expect(maxAge).toBeGreaterThan(8 * 60 * 60 - 120);

      const yo = await a.agente
        .get(RUTA_ADMIN)
        .set('Authorization', `Bearer ${r.body.tokenAcceso}`)
        .expect(200);
      expect(yo.body).toMatchObject({ adminId: ad.adminId, rol: 'ADMIN_PLATAFORMA' });
    });

    it('acepta el código del paso anterior y del siguiente (±1), y no uno más lejano', async () => {
      const ad = await admin();
      const ahora = reloj.ahora();
      const lejos = codigoPara(ad.secreto, new Date(ahora.getTime() - 90_000));
      const enVentana = [-30_000, 0, 30_000].some(
        (ms) => codigoPara(ad.secreto, new Date(ahora.getTime() + ms)) === lejos,
      );
      if (!enVentana)
        await app(a)
          .segundoFactor({ desafio: await desafio(a, ad), codigo: lejos })
          .expect(401);
      const anterior = codigoPara(ad.secreto, new Date(ahora.getTime() - 30_000));
      await app(a)
        .segundoFactor({ desafio: await desafio(a, ad), codigo: anterior })
        .expect(200);
      const siguiente = codigoPara(ad.secreto, new Date(ahora.getTime() + 30_000));
      await app(a)
        .segundoFactor({ desafio: await desafio(a, ad), codigo: siguiente })
        .expect(200);
    });

    it('un desafío vencido o ya usado da 401', async () => {
      const ad = await admin();
      const vencido = await desafio(a, ad);
      reloj.avanzar(5 * 60 * 1000);
      reloj.siguientePaso();
      await app(a)
        .segundoFactor({ desafio: vencido, codigo: codigoPara(ad.secreto, reloj.ahora()) })
        .expect(401);

      const usado = await desafio(a, ad);
      await app(a)
        .segundoFactor({ desafio: usado, codigo: codigoPara(ad.secreto, reloj.ahora()) })
        .expect(200);
      reloj.siguientePaso();
      await app(a)
        .segundoFactor({ desafio: usado, codigo: codigoPara(ad.secreto, reloj.ahora()) })
        .expect(401);
      await app(a)
        .segundoFactor({ desafio: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', codigo: '123456' })
        .expect(401);
    });

    it('un código ya usado da 401, también si llega por la otra réplica', async () => {
      const ad = await admin();
      const codigo = codigoPara(ad.secreto, reloj.ahora());
      await app(a)
        .segundoFactor({ desafio: await desafio(a, ad), codigo })
        .expect(200);
      await app(a)
        .segundoFactor({ desafio: await desafio(a, ad), codigo })
        .expect(401, NO_AUTENTICADO);
      await app(b)
        .segundoFactor({ desafio: await desafio(b, ad), codigo })
        .expect(401, NO_AUTENTICADO);
      // El del paso anterior tampoco, aunque esté dentro de la tolerancia: ya se entró con uno posterior.
      const anterior = codigoPara(ad.secreto, new Date(reloj.ahora().getTime() - 30_000));
      if (anterior !== codigo)
        await app(b)
          .segundoFactor({ desafio: await desafio(b, ad), codigo: anterior })
          .expect(401);
    });

    it('dos ingresos simultáneos con el mismo código, uno por réplica, abren una sola sesión', async () => {
      for (let intento = 0; intento < 5; intento += 1) {
        reloj.siguientePaso();
        const ad = await admin({ recuperacion: false });
        const [d1, d2] = await Promise.all([desafio(a, ad), desafio(b, ad)]);
        const codigo = codigoPara(ad.secreto, reloj.ahora());
        const respuestas = await Promise.all([
          app(a).segundoFactor({ desafio: d1, codigo }),
          app(b).segundoFactor({ desafio: d2, codigo }),
        ]);
        expect(respuestas.map((r) => r.status).sort()).toEqual([200, 401]);
        const { rows } = await seed().query(
          'SELECT count(*)::int AS n FROM platform_session WHERE admin_id = $1',
          [ad.adminId],
        );
        expect(rows[0].n).toBe(1);
      }
    });

    it('dos usos simultáneos del mismo desafío con el mismo código abren una sola sesión', async () => {
      const ad = await admin({ recuperacion: false });
      const d = await desafio(a, ad);
      const codigo = codigoPara(ad.secreto, reloj.ahora());
      const respuestas = await Promise.all([
        app(a).segundoFactor({ desafio: d, codigo }),
        app(b).segundoFactor({ desafio: d, codigo }),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 401]);
    });

    it('un código de recuperación sirve una sola vez, en cualquier réplica', async () => {
      const ad = await admin();
      const [codigo] = ad.codigosRecuperacion;
      const r = await app(a)
        .segundoFactor({ desafio: await desafio(a, ad), codigoRecuperacion: codigo })
        .expect(200);
      expect(reclamaciones(r.body.tokenAcceso).sub).toBe(ad.adminId);
      const { rows } = await seed().query('SELECT totp_step FROM platform_session WHERE admin_id = $1', [
        ad.adminId,
      ]);
      expect(rows).toEqual([{ totp_step: null }]);

      await app(a)
        .segundoFactor({ desafio: await desafio(a, ad), codigoRecuperacion: codigo })
        .expect(401);
      await app(b)
        .segundoFactor({ desafio: await desafio(b, ad), codigoRecuperacion: codigo.toLowerCase() })
        .expect(401);
      // Otro código del mismo administrador sigue sirviendo.
      await app(b)
        .segundoFactor({ desafio: await desafio(b, ad), codigoRecuperacion: ad.codigosRecuperacion[1] })
        .expect(200);
    });

    it('dos usos simultáneos del mismo código de recuperación dejan uno solo aceptado', async () => {
      const ad = await admin();
      const [d1, d2] = await Promise.all([desafio(a, ad), desafio(b, ad)]);
      const codigoRecuperacion = ad.codigosRecuperacion[4];
      const respuestas = await Promise.all([
        app(a).segundoFactor({ desafio: d1, codigoRecuperacion }),
        app(b).segundoFactor({ desafio: d2, codigoRecuperacion }),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 401]);
      const { rows } = await seed().query(
        'SELECT count(*)::int AS n FROM platform_challenge WHERE admin_id = $1 AND used_recovery_index = 4',
        [ad.adminId],
      );
      expect(rows[0].n).toBe(1);
    });

    it('sin código, con los dos a la vez o con un formato inválido responde 400 sin repetir el valor', async () => {
      const ad = await admin();
      const d = await desafio(a, ad);
      const conLosDos = await app(a)
        .segundoFactor({ desafio: d, codigo: '123456', codigoRecuperacion: ad.codigosRecuperacion[2] })
        .expect(400);
      expect(JSON.stringify(conLosDos.body)).not.toContain(ad.codigosRecuperacion[2]);
      await app(a).segundoFactor({ desafio: d }).expect(400);
      const formato = await app(a).segundoFactor({ desafio: d, codigo: '12345x' }).expect(400);
      expect(JSON.stringify(formato.body)).not.toContain('12345x');
    });
  });

  describe('bloqueo por intentos (login_attempt)', () => {
    it('5 contraseñas incorrectas en 15 minutos dan 429, también con la contraseña correcta, hasta que pasan', async () => {
      const ad = await admin({ recuperacion: false });
      for (let i = 0; i < 5; i += 1) await app(a).ingresar(ad.correo, `mala-${i}`).expect(401);
      const bloqueado = await app(b).ingresar(ad.correo, ad.contrasena).expect(429);
      expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
      expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(bloqueado.headers['retry-after'])).toBeLessThanOrEqual(15 * 60);

      reloj.avanzar(15 * 60 * 1000);
      reloj.siguientePaso();
      const r = await ingresoCompleto(a, ad);
      expect(r.status).toBe(200);
    });

    it('los fallos del segundo factor cuentan, y una contraseña correcta no los borra', async () => {
      const ad = await admin({ recuperacion: false });
      await app(a).ingresar(ad.correo, 'mala').expect(401);
      await app(a).ingresar(ad.correo, 'mala').expect(401);
      const d = await desafio(a, ad);
      for (const codigo of ['000000', '111111', '222222']) {
        if (codigo === codigoPara(ad.secreto, reloj.ahora())) continue;
        await app(a).segundoFactor({ desafio: d, codigo }).expect(401);
      }
      // Quinto fallo cumplido (o cuarto, si un código fijo coincidió por azar): el segundo factor queda bloqueado.
      await app(a).segundoFactor({ desafio: d, codigo: '333333' });
      await app(a)
        .segundoFactor({ desafio: d, codigo: codigoPara(ad.secreto, reloj.ahora()) })
        .expect(429);
      await app(b).ingresar(ad.correo, ad.contrasena).expect(429);
    });
  });

  describe('renovar y salir', () => {
    it('renueva con la cookie y la rota; el token anterior revoca la sesión (robo)', async () => {
      const ad = await admin({ recuperacion: false });
      const inicio = await ingresoCompleto(a, ad);
      const cookie = (cookieDe(inicio) as string).split(';')[0];
      const renovada = await b.agente
        .post('/api/v1/plataforma/auth/renovar')
        .set('Cookie', cookie)
        .expect(200);
      expect(reclamaciones(renovada.body.tokenAcceso)).toMatchObject({ aud: 'plataforma', sub: ad.adminId });
      const nueva = (cookieDe(renovada) as string).split(';')[0];
      expect(nueva).not.toBe(cookie);

      // El token ya rotado: se trata como robo y la sesión entera queda revocada.
      await a.agente.post('/api/v1/plataforma/auth/renovar').set('Cookie', cookie).expect(401);
      await a.agente.post('/api/v1/plataforma/auth/renovar').set('Cookie', nueva).expect(401);
      await a.agente.get(RUTA_ADMIN).set('Authorization', `Bearer ${renovada.body.tokenAcceso}`).expect(401);
      const { rows } = await seed().query('SELECT status FROM platform_session WHERE admin_id = $1', [
        ad.adminId,
      ]);
      expect(rows).toEqual([{ status: 'REVOCADA' }]);
    });

    it('no renueva después de la vida máxima de 8 horas', async () => {
      const ad = await admin({ recuperacion: false });
      const inicio = await ingresoCompleto(a, ad);
      const cookie = (cookieDe(inicio) as string).split(';')[0];
      reloj.avanzar(8 * 60 * 60 * 1000);
      await a.agente.post('/api/v1/plataforma/auth/renovar').set('Cookie', cookie).expect(401);
      await a.agente.get(RUTA_ADMIN).set('Authorization', `Bearer ${inicio.body.tokenAcceso}`).expect(401);
      // El reloj vuelve cerca de la hora real (login_attempt purga por antigüedad).
      reloj.avanzar(-8 * 60 * 60 * 1000);
    });

    it('salir cierra la sesión: el token de acceso y el de renovación dejan de servir, en las dos réplicas', async () => {
      const ad = await admin({ recuperacion: false });
      const inicio = await ingresoCompleto(a, ad);
      const cookie = (cookieDe(inicio) as string).split(';')[0];
      const salida = await a.agente
        .post('/api/v1/plataforma/auth/salir')
        .set('Authorization', `Bearer ${inicio.body.tokenAcceso}`)
        .expect(204);
      expect(cookieDe(salida)).toMatch(/^rtp=;.*Path=\/api\/v1\/plataforma\/auth/);
      await b.agente.get(RUTA_ADMIN).set('Authorization', `Bearer ${inicio.body.tokenAcceso}`).expect(401);
      await b.agente.post('/api/v1/plataforma/auth/renovar').set('Cookie', cookie).expect(401);
      await b.agente
        .post('/api/v1/plataforma/auth/salir')
        .set('Authorization', `Bearer ${inicio.body.tokenAcceso}`)
        .expect(401);
      // La cookie de barbería no sirve para renovar la de plataforma (otro nombre y otra ruta).
      await a.agente
        .post('/api/v1/plataforma/auth/renovar')
        .set('Cookie', cookie.replace(/^rtp=/, 'rt='))
        .expect(401);
    });
  });

  it('platform_audit_log registra el ingreso, los fallos, la recuperación y la salida, con la IP', async () => {
    const ad = await admin();
    await app(a).ingresar(ad.correo, 'mala').expect(401);
    const d = await desafio(a, ad);
    const malo = codigoPara(ad.secreto, reloj.ahora()) === '999999' ? '888888' : '999999';
    await app(a).segundoFactor({ desafio: d, codigo: malo }).expect(401);
    const r = await app(a)
      .segundoFactor({ desafio: d, codigoRecuperacion: ad.codigosRecuperacion[9] })
      .expect(200);
    await a.agente
      .post('/api/v1/plataforma/auth/salir')
      .set('Authorization', `Bearer ${r.body.tokenAcceso}`)
      .expect(204);

    const filas = await auditoria(ad.adminId);
    expect(filas.map((f) => [f.action, f.result])).toEqual([
      ['ADMIN_INGRESO_FALLIDO', 'DENEGADO'],
      ['ADMIN_SEGUNDO_FACTOR_FALLIDO', 'DENEGADO'],
      ['ADMIN_INGRESO', 'PERMITIDO'],
      ['ADMIN_CODIGO_RECUPERACION_USADO', 'PERMITIDO'],
      ['ADMIN_SALIDA', 'PERMITIDO'],
    ]);
    for (const fila of filas) expect(fila.ip).toEqual(expect.any(String));
    // Un correo inexistente queda auditado sin administrador.
    const antes = (
      await seed().query('SELECT count(*)::int AS n FROM platform_audit_log WHERE admin_id IS NULL')
    ).rows[0].n;
    await app(a).ingresar('nadie-auditado@plataforma.prueba', 'mala').expect(401);
    const despues = (
      await seed().query('SELECT count(*)::int AS n FROM platform_audit_log WHERE admin_id IS NULL')
    ).rows[0].n;
    expect(despues).toBe(antes + 1);
  });

  it.each(['/api/v1/agenda', '/api/v1/clientes', '/api/v1/servicios'])(
    'el token del administrador da 401 en la ruta de barbería %s',
    async (ruta) => {
      const ad = await admin({ recuperacion: false });
      const r = await ingresoCompleto(a, ad);
      await a.agente.get(ruta).set('Authorization', `Bearer ${r.body.tokenAcceso}`).expect(401);
    },
  );

  // Último: revisa todo lo que dejaron las pruebas anteriores.
  it('canarios (SC-010): ni el secreto, ni la URI otpauth, ni los códigos, ni la contraseña quedan en ningún lado', async () => {
    expect(canarios.length).toBeGreaterThan(50);
    const tablas = await seed().query(
      `SELECT (SELECT coalesce(json_agg(p), '[]')::text FROM platform_audit_log p) AS plataforma,
              (SELECT coalesce(json_agg(x), '[]')::text FROM audit_log x) AS barberias,
              (SELECT coalesce(json_agg(s), '[]')::text FROM platform_session s) AS sesiones,
              (SELECT coalesce(json_agg(c), '[]')::text FROM platform_challenge c) AS desafios`,
    );
    const lugares: Record<string, string> = {
      registros,
      respuestasDeError: errores.join('\n'),
      ...tablas.rows[0],
    };
    expect(errores.length).toBeGreaterThan(10);
    const hallazgos = Object.entries(lugares).flatMap(([lugar, texto]) =>
      canarios
        .filter((canario) => texto.includes(canario))
        .map((canario) => `${lugar}: ${canario.slice(0, 6)}…`),
    );
    expect(hallazgos).toEqual([]);
    expect(registros).not.toMatch(/otpauth:\/\//);
  });
});
