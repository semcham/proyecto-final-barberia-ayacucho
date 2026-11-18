import { createHash } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { type BarberiaSembrada, sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T076 · PR12: límite de intentos de inicio de sesión por cuenta + IP (R10, EQ-12, SC-006).
// La app confía en X-Forwarded-For desde loopback (trust proxy), así se simulan IP distintas.

const LOGIN = '/api/v1/auth/login';
const hashCorreo = (correo: string) => createHash('sha256').update(correo).digest('hex');
/** 007 (US3): SHA-256(INTENTOS_SAL_IP ‖ ip), como lo deriva el adaptador. La sal es la de entorno.ts, nunca del .env. */
const origenDerivado = (sal: string, ip: string) => createHash('sha256').update(sal).update(ip).digest('hex');
const SAL = process.env.INTENTOS_SAL_IP as string;

describe('Límite de intentos (PR12)', () => {
  let prueba: AppDePrueba;
  let victima: BarberiaSembrada;
  let otraCuenta: BarberiaSembrada;

  beforeAll(async () => {
    prueba = await crearApp();
    victima = await sembrarBarberia();
    otraCuenta = await sembrarBarberia();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const intentar = (correo: string, contrasena: string, ip: string) =>
    prueba.agente.post(LOGIN).set('X-Forwarded-For', ip).send({ correo, contrasena });

  it('5 fallos pasan (401); el sexto da 429 con Retry-After, aunque la contraseña sea correcta', async () => {
    const ip = '203.0.113.10';
    for (let i = 0; i < 5; i += 1) await intentar(victima.correo, 'contrasena-errada', ip).expect(401);

    const bloqueado = await intentar(victima.correo, victima.contrasena, ip).expect(429);
    expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
    const espera = Number(bloqueado.headers['retry-after']);
    expect(espera).toBeGreaterThan(0);
    expect(espera).toBeLessThanOrEqual(60);
  });

  it('otra cuenta desde la misma IP sigue pudiendo entrar', async () => {
    await intentar(otraCuenta.correo, otraCuenta.contrasena, '203.0.113.10').expect(200);
  });

  it('la misma cuenta desde otra IP sigue pudiendo entrar (un atacante no bloquea a la víctima)', async () => {
    await intentar(victima.correo, victima.contrasena, '198.51.100.20').expect(200);
  });

  it('un acierto borra los fallos previos del par cuenta + IP', async () => {
    const ip = '198.51.100.30';
    for (let i = 0; i < 4; i += 1) await intentar(otraCuenta.correo, 'contrasena-errada', ip).expect(401);
    await intentar(otraCuenta.correo, otraCuenta.contrasena, ip).expect(200);
    for (let i = 0; i < 4; i += 1) await intentar(otraCuenta.correo, 'contrasena-errada', ip).expect(401);
    await intentar(otraCuenta.correo, otraCuenta.contrasena, ip).expect(200);
  });

  it('guarda el hash del correo, no el correo, y purga los intentos de más de 24 h', async () => {
    const seed = poolDe('seed');
    // 007 (US3): la fila antigua se siembra con el origen ya derivado (la columna `ip` ya no existe).
    await seed.query(
      "INSERT INTO login_attempt (email_hash, ip_hash, attempted_at) VALUES ($1, $2, now() - interval '25 hours')",
      [hashCorreo('antiguo@prueba.pe'), origenDerivado(SAL, '192.0.2.1')],
    );
    await intentar('alguien@prueba.pe', 'contrasena-errada', '192.0.2.2').expect(401);

    const { rows } = await seed.query<{ email_hash: string; attempted_at: Date }>(
      'SELECT email_hash, attempted_at FROM login_attempt',
    );
    expect(rows.some((fila) => fila.email_hash === hashCorreo('antiguo@prueba.pe'))).toBe(false);
    expect(rows.some((fila) => fila.email_hash === hashCorreo('alguien@prueba.pe'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('@');
  });

  // T058 de 007 · US3 (FR-017, SC-006): el origen se guarda solo derivado con la sal; ninguna IP legible.
  it('login_attempt no tiene la columna ip: guarda SHA-256(INTENTOS_SAL_IP ‖ ip), distinto de la IP', async () => {
    const seed = poolDe('seed');
    const columnas = await seed.query<{ columna: string }>(
      `SELECT column_name AS columna FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'login_attempt' ORDER BY ordinal_position`,
    );
    expect(columnas.rows.map((f) => f.columna)).toEqual(['id', 'email_hash', 'attempted_at', 'ip_hash']);

    const ip = '203.0.113.77';
    const correo = 'derivado@prueba.pe';
    for (let i = 0; i < 2; i += 1) await intentar(correo, 'contrasena-errada', ip).expect(401);
    const { rows } = await seed.query<{ ip_hash: string }>(
      'SELECT ip_hash FROM login_attempt WHERE email_hash = $1',
      [hashCorreo(correo)],
    );
    expect(rows).toHaveLength(2);
    for (const fila of rows) {
      expect(fila.ip_hash).toBe(origenDerivado(SAL, ip));
      expect(fila.ip_hash).not.toContain(ip);
    }
    // Ninguna fila de la tabla contiene una IP legible.
    const todas = await seed.query('SELECT * FROM login_attempt');
    expect(JSON.stringify(todas.rows)).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });

  it('el bloqueo, el mensaje y el Retry-After son los de antes, y otro origen no queda bloqueado', async () => {
    const cuenta = await sembrarBarberia();
    const ip = '203.0.113.88';
    for (let i = 0; i < 5; i += 1) await intentar(cuenta.correo, 'contrasena-errada', ip).expect(401);
    const bloqueado = await intentar(cuenta.correo, cuenta.contrasena, ip).expect(429);
    expect(bloqueado.body).toEqual({
      codigo: 'DEMASIADOS_INTENTOS',
      mensaje: expect.any(String),
      detalles: [{ reintentarEnSegundos: Number(bloqueado.headers['retry-after']) }],
    });
    await intentar(cuenta.correo, cuenta.contrasena, '203.0.113.89').expect(200);
  });
});

// T058 de 007 · FR-020: con una sal marcador, el marcador no aparece en los registros de la aplicación, ni en
// audit_log, ni en platform_audit_log, ni en los cuerpos de error (patrón de registro-asistente de 005).
describe('La sal de los intentos no aparece en ningún registro ni auditoría (FR-020)', () => {
  const MARCADOR = 'sal-marcador-intentos-ocelote-9031';
  let prueba: AppDePrueba;
  const salida: string[] = [];
  const errores: string[] = [];
  const escrituras = {
    stdout: process.stdout.write.bind(process.stdout),
    stderr: process.stderr.write.bind(process.stderr),
  };

  beforeAll(async () => {
    prueba = await crearApp({ entorno: { INTENTOS_SAL_IP: MARCADOR } });
    process.stdout.write = ((trozo: unknown, ...resto: unknown[]) => {
      salida.push(String(trozo));
      return (escrituras.stdout as (...a: unknown[]) => boolean)(trozo, ...resto);
    }) as typeof process.stdout.write;
    process.stderr.write = ((trozo: unknown, ...resto: unknown[]) => {
      salida.push(String(trozo));
      return (escrituras.stderr as (...a: unknown[]) => boolean)(trozo, ...resto);
    }) as typeof process.stderr.write;
  });

  afterAll(async () => {
    process.stdout.write = escrituras.stdout;
    process.stderr.write = escrituras.stderr;
    await prueba.cerrar();
    await cerrarPools();
  });

  it('ni en los registros, ni en audit_log, ni en platform_audit_log, ni en los errores', async () => {
    const barberia = await sembrarBarberia();
    const ip = '198.51.100.123';
    const enviar = (ruta: string, cuerpo: object) =>
      prueba.agente
        .post(ruta)
        .set('X-Forwarded-For', ip)
        .send(cuerpo)
        .expect((r) => {
          if (r.status >= 400) errores.push(JSON.stringify(r.body));
        });
    // Personal: fallos hasta el bloqueo.
    for (let i = 0; i < 6; i += 1) await enviar(LOGIN, { correo: barberia.correo, contrasena: 'mala' });
    // Administrador de la plataforma: fallos auditados en platform_audit_log.
    for (let i = 0; i < 3; i += 1) {
      await enviar('/api/v1/plataforma/auth/ingresar', {
        correo: 'nadie-marcador@plataforma.prueba',
        contrasena: 'mala',
      });
    }

    // La sal marcador se usó de verdad: el origen guardado se deriva con ella.
    const { rows } = await poolDe('seed').query<{ ip_hash: string }>(
      'SELECT ip_hash FROM login_attempt WHERE email_hash = $1',
      [hashCorreo(barberia.correo)],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const fila of rows) expect(fila.ip_hash).toBe(origenDerivado(MARCADOR, ip));

    const auditoria = await poolDe('seed').query('SELECT * FROM audit_log WHERE tenant_id = $1', [
      barberia.tenantId,
    ]);
    const plataforma = await poolDe('seed').query('SELECT * FROM platform_audit_log');
    expect(plataforma.rows.length).toBeGreaterThan(0);
    expect(errores.length).toBeGreaterThan(0);
    for (const texto of [
      salida.join(''),
      JSON.stringify(auditoria.rows),
      JSON.stringify(plataforma.rows),
      errores.join('\n'),
    ]) {
      expect(texto).not.toContain(MARCADOR);
    }
  });
});
