import { createHash } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { type BarberiaSembrada, sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T076 · PR12: límite de intentos de inicio de sesión por cuenta + IP (R10, EQ-12, SC-006).
// La app confía en X-Forwarded-For desde loopback (trust proxy), así se simulan IP distintas.

const LOGIN = '/api/v1/auth/login';
const hashCorreo = (correo: string) => createHash('sha256').update(correo).digest('hex');

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
    await seed.query(
      "INSERT INTO login_attempt (email_hash, ip, attempted_at) VALUES ($1, '192.0.2.1', now() - interval '25 hours')",
      [hashCorreo('antiguo@prueba.pe')],
    );
    await intentar('alguien@prueba.pe', 'contrasena-errada', '192.0.2.2').expect(401);

    const { rows } = await seed.query<{ email_hash: string; attempted_at: Date }>(
      'SELECT email_hash, attempted_at FROM login_attempt',
    );
    expect(rows.some((fila) => fila.email_hash === hashCorreo('antiguo@prueba.pe'))).toBe(false);
    expect(rows.some((fila) => fila.email_hash === hashCorreo('alguien@prueba.pe'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('@');
  });
});
