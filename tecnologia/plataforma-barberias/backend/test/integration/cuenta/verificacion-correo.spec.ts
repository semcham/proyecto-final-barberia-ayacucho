import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { correrTareasDeAvisos, descartarAvisosDeOtrasPruebas, esperarCorreos } from '../../helpers/avisos';
import { ipUnica } from '../../helpers/enlaces';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { tokenDelCorreo } from '../../helpers/verificacion';

// T049 de 010 · Verificación del correo (US1; FR-002 a FR-009, FR-013; research R04, R07, R08 y R15; G3):
// - el registro deja la cuenta sin verificar y envía el correo;
// - el enlace verifica SIN sesión y devuelve la barbería de origen; la verificación vale para todas sus barberías;
// - usado, vencido o reemplazado → el mismo 410. El vencimiento lo decide la función de sistema con la hora de la base
//   (now()), así que el "reloj controlado" es mover las fechas del enlace 25 h atrás en la base;
// - un token desconocido o mal formado da el mismo 410 y queda SOLO como USO_FALLIDO, sin auditoría (R15);
// - el uso fallido n.º 21 desde un mismo origen en una hora → 429 (G3);
// - ninguna respuesta por debajo del piso de tiempo (R07, parte funcional de SC-005).

jest.setTimeout(180_000);

const REGISTRO = '/api/v1/clientes/registro';
const VERIFICAR = '/api/v1/cuenta/verificacion';
const VERSION = process.env.PRIVACY_POLICY_VERSION as string;
const PISO_MS = Number(process.env.CUENTA_RESPUESTA_MINIMA_MS);

const correoNuevo = (prefijo: string) =>
  `${prefijo}-${Date.now()}-${Math.round(Math.random() * 1e6)}@prueba.pe`;

describe('Verificación del correo (T049 de 010)', () => {
  let mailpit: Mailpit;
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  const filas = async (sql: string, parametros: unknown[]) =>
    (await poolDe('seed').query(sql, parametros)).rows;

  const verificar = (token: string, ip = ipUnica()) =>
    request(prueba.app.getHttpServer()).post(VERIFICAR).set('X-Forwarded-For', ip).send({ token });

  async function registrar(slug: string, correo = correoNuevo('cli')) {
    const respuesta = await request(prueba.app.getHttpServer())
      .post(REGISTRO)
      .set('X-Forwarded-For', ipUnica())
      .send({
        barberia: slug,
        nombre: 'Lucía Pariona',
        correo,
        telefono: '966 555 111',
        contrasena: 'clave-de-lucia-segura',
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: VERSION,
      })
      .expect(201);
    return { correo, usuarioId: respuesta.body.usuario.id as string, sesion: respuesta.body };
  }

  /** Envía los avisos pendientes y devuelve el token del último correo de verificación de `correo`. */
  async function tokenRecibido(correo: string, n = 1): Promise<string> {
    await correrTareasDeAvisos(prueba);
    const correos = await esperarCorreos(mailpit, correo, n);
    expect(correos).toHaveLength(n);
    return tokenDelCorreo(correos[n - 1].texto, 'verificar');
  }

  const verificacionDe = async (usuarioId: string) =>
    (
      await filas(
        'SELECT email_verified_via AS via, email_verified_at AS fecha FROM user_account WHERE id = $1',
        [usuarioId],
      )
    )[0];

  const auditoriaDe = async (usuarioId: string) =>
    (
      await filas(
        `SELECT tenant_id, action, result, resource FROM audit_log
         WHERE actor_id = $1 AND action IN ('CORREO_VERIFICADO', 'ENLACE_DE_CUENTA_RECHAZADO',
                                            'CORREO_VERIFICACION_SOLICITADA') ORDER BY at`,
        [usuarioId],
      )
    ).map((f) => ({ tenant_id: f.tenant_id, action: f.action, result: f.result, resource: f.resource }));

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    prueba = await crearApp({
      entorno: { SMTP_HOST: mailpit.host, SMTP_PUERTO: String(mailpit.puertoSmtp) },
    });
    a = await sembrarBarberia({ nombre: 'Barbería Wari' });
    b = await sembrarBarberia({ nombre: 'Barbería Pokra' });
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await prueba.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('el registro deja la cuenta sin verificar y envía el correo con el enlace de /verificar', async () => {
    const { correo, usuarioId, sesion } = await registrar(a.slug);
    expect(sesion.usuario.correoVerificado).toBe(false);
    expect(await verificacionDe(usuarioId)).toEqual({ via: null, fecha: null });
    const token = await tokenRecibido(correo);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(await auditoriaDe(usuarioId)).toEqual([
      {
        tenant_id: a.tenantId,
        action: 'CORREO_VERIFICACION_SOLICITADA',
        result: 'PERMITIDO',
        resource: `cuenta:${usuarioId}`,
      },
    ]);
  });

  it('el enlace verifica sin sesión, devuelve la barbería de origen y vale para todas las barberías del cliente', async () => {
    const { correo, usuarioId } = await registrar(a.slug);
    // El mismo cliente se une a B (por SQL; la unión no es de esta prueba).
    await sembrarCliente({ tenantId: b.tenantId, usuarioId });
    const token = await tokenRecibido(correo);

    const inicio = performance.now();
    const respuesta = await verificar(token).expect(200);
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(PISO_MS - 5);
    expect(respuesta.body).toEqual({ barberia: a.slug });

    expect(await verificacionDe(usuarioId)).toEqual({ via: 'ENLACE', fecha: expect.any(Date) });
    // La cuenta es una sola: con la sesión de cualquiera de sus barberías se ve verificada.
    for (const barberia of [a, b]) {
      const login = await request(prueba.app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('X-Forwarded-For', ipUnica())
        .send({ correo, contrasena: 'clave-de-lucia-segura', barberia: barberia.slug })
        .expect(200);
      expect(login.body.usuario.correoVerificado).toBe(true);
    }
    expect(await auditoriaDe(usuarioId)).toContainEqual({
      tenant_id: a.tenantId,
      action: 'CORREO_VERIFICADO',
      result: 'PERMITIDO',
      resource: `cuenta:${usuarioId};VERIFICAR_CORREO`,
    });
  });

  it('usado, vencido o reemplazado: el mismo 410, auditado como rechazo en la barbería del enlace', async () => {
    // Usado.
    const usado = await registrar(a.slug);
    const tokenUsado = await tokenRecibido(usado.correo);
    await verificar(tokenUsado).expect(200);
    const segundaVez = await verificar(tokenUsado).expect(410);

    // Vencido: el correo llega; luego el enlace pasa a haberse pedido hace 25 h (vence a las 24 h).
    const vencido = await registrar(a.slug);
    const tokenVencido = await tokenRecibido(vencido.correo);
    await poolDe('seed').query(
      `UPDATE account_link SET requested_at = requested_at - interval '25 hours',
                               expires_at = expires_at - interval '25 hours' WHERE user_id = $1`,
      [vencido.usuarioId],
    );
    const respuestaVencido = await verificar(tokenVencido).expect(410);

    // Reemplazado: un segundo enlace anula el primero.
    const reemplazado = await registrar(b.slug);
    const primero = await tokenRecibido(reemplazado.correo);
    const login = await request(prueba.app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ipUnica())
      .send({ correo: reemplazado.correo, contrasena: 'clave-de-lucia-segura', barberia: b.slug })
      .expect(200);
    await request(prueba.app.getHttpServer())
      .post('/api/v1/cuenta/verificacion/reenvio')
      .set({ Authorization: `Bearer ${login.body.tokenAcceso}`, 'X-Forwarded-For': ipUnica() })
      .expect(202);
    const segundo = await tokenRecibido(reemplazado.correo, 2);
    expect(segundo).not.toBe(primero);
    const respuestaReemplazado = await verificar(primero).expect(410);

    // Mismo cuerpo en los tres casos, sin pistas de por qué.
    for (const r of [segundaVez, respuestaVencido, respuestaReemplazado]) {
      expect(r.body).toEqual(segundaVez.body);
    }
    expect(segundaVez.body.codigo).toBe('ENLACE_NO_VALIDO');
    expect(await verificacionDe(vencido.usuarioId)).toEqual({ via: null, fecha: null });
    expect(await verificacionDe(reemplazado.usuarioId)).toEqual({ via: null, fecha: null });

    for (const [caso, barberia] of [
      [usado, a],
      [vencido, a],
      [reemplazado, b],
    ] as const) {
      expect(await auditoriaDe(caso.usuarioId)).toContainEqual({
        tenant_id: barberia.tenantId,
        action: 'ENLACE_DE_CUENTA_RECHAZADO',
        result: 'DENEGADO',
        resource: `cuenta:${caso.usuarioId};VERIFICAR_CORREO`,
      });
    }
    // El segundo enlace sí sirve.
    await verificar(segundo).expect(200);
  });

  it('un token desconocido o mal formado: el mismo 410, solo como USO_FALLIDO y sin auditoría (R15)', async () => {
    const ip = ipUnica();
    const auditoriaAntes = (await filas('SELECT count(*)::int AS n FROM audit_log', []))[0].n;
    const desconocido = await verificar(randomBytes(32).toString('base64url'), ip).expect(410);
    const malFormado = await verificar('esto no es un token válido!!', ip).expect(410);
    expect(malFormado.body).toEqual(desconocido.body);
    expect(desconocido.body.codigo).toBe('ENLACE_NO_VALIDO');

    const intentos = await filas(
      `SELECT kind, subject_hash FROM account_link_attempt
       WHERE kind = 'USO_FALLIDO' AND at > now() - interval '1 minute'`,
      [],
    );
    expect(intentos.length).toBeGreaterThanOrEqual(2);
    expect(intentos.every((f) => f.subject_hash === null)).toBe(true);
    // Ni la IP ni el token quedan en la tabla.
    const crudo = JSON.stringify(await filas('SELECT * FROM account_link_attempt', []));
    expect(crudo).not.toContain(ip);
    expect((await filas('SELECT count(*)::int AS n FROM audit_log', []))[0].n).toBe(auditoriaAntes);
  });

  it('el uso fallido n.º 21 desde un mismo origen en una hora → 429 con Retry-After (G3); otro origen sigue', async () => {
    const ip = ipUnica();
    for (let i = 0; i < 20; i++) {
      await verificar(randomBytes(32).toString('base64url'), ip).expect(410);
    }
    const bloqueado = await verificar(randomBytes(32).toString('base64url'), ip).expect(429);
    expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    expect(bloqueado.body.detalles[0].reintentarEnSegundos).toBe(Number(bloqueado.headers['retry-after']));
    // Otro origen no se ve afectado.
    await verificar(randomBytes(32).toString('base64url'), ipUnica()).expect(410);
  });

  it('cuerpo mal formado (sin token o fuera de largo) → 400, no 410', async () => {
    await request(prueba.app.getHttpServer()).post(VERIFICAR).send({}).expect(400);
    await verificar('corto').expect(400);
    await request(prueba.app.getHttpServer())
      .post(VERIFICAR)
      .send({ token: randomBytes(32).toString('base64url'), extra: 1 })
      .expect(400);
  });
});
