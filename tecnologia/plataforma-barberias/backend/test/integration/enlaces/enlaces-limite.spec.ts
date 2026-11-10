import { createHash } from 'node:crypto';
import { EjecutorTareas } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { citaConEnlaces, ipUnica, solicitudDeEnlace } from '../../helpers/enlaces';
import { type BarberiaParaReservar, barberiaParaReservar } from '../../helpers/reservas';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T081 · Límite de los enlaces por IP (FR-031; constitución 1.4.1, principio III, tablas técnicas de intentos).
// - 5 rechazos en 60 s → 429 DEMASIADOS_INTENTOS con reintentarEnSegundos (y Retry-After), también para un enlace
//   válido: el bloqueo se mira antes de verificar nada;
// - action_link_attempt guarda solo SHA-256(ENLACES_SAL_IP ‖ IP), nunca la IP en claro;
// - la tarea purgar-intentos-enlaces borra las filas de más de 24 h y deja las recientes;
// - el límite general de las rutas de enlaces: 30 solicitudes por minuto por IP.

const SAL = process.env.ENLACES_SAL_IP as string;
const hashDe = (ip: string) => createHash('sha256').update(SAL).update(ip).digest('hex');

describe('Límite de los enlaces por IP (T081)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('5 rechazos en 60 s → 429 con reintentarEnSegundos; el sexto, aun con un enlace válido, no se atiende', async () => {
    const ip = ipUnica();
    for (let i = 0; i < 5; i += 1) {
      await solicitudDeEnlace(prueba, 'consultar', `inventado.${i}`, ip).expect(410);
    }
    const c = await citaConEnlaces(prueba, e, 300);
    const bloqueada = await solicitudDeEnlace(prueba, 'confirmar', c.enlace('CONFIRMAR'), ip).expect(429);
    expect(bloqueada.body.codigo).toBe('DEMASIADOS_INTENTOS');
    const [{ reintentarEnSegundos }] = bloqueada.body.detalles;
    expect(reintentarEnSegundos).toBeGreaterThan(0);
    expect(reintentarEnSegundos).toBeLessThanOrEqual(60);
    expect(Number(bloqueada.headers['retry-after'])).toBe(reintentarEnSegundos);
    // La cita no cambió y el bloqueo no se anotó como otro rechazo.
    const { rows } = await poolDe('seed').query('SELECT client_confirmed_at FROM appointment WHERE id = $1', [
      c.citaId,
    ]);
    expect(rows[0].client_confirmed_at).toBeNull();
    const intentos = await poolDe('seed').query(
      'SELECT count(*)::int AS total FROM action_link_attempt WHERE ip_hash = $1',
      [hashDe(ip)],
    );
    expect(intentos.rows[0].total).toBe(5);

    // Otra IP sigue sin bloqueo.
    await solicitudDeEnlace(prueba, 'confirmar', c.enlace('CONFIRMAR'), ipUnica()).expect(200);
  });

  it('action_link_attempt guarda solo el hash de la IP con la sal, nunca la IP en claro', async () => {
    const ip = ipUnica();
    await solicitudDeEnlace(prueba, 'consultar', 'otro.inventado', ip).expect(410);
    const { rows } = await poolDe('seed').query(
      `SELECT ip_hash FROM action_link_attempt WHERE ip_hash = $1`,
      [hashDe(ip)],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ip_hash).not.toContain(ip);
    expect(rows[0].ip_hash).not.toBe(createHash('sha256').update(ip).digest('hex'));
    const { rows: columnas } = await poolDe('seed').query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'action_link_attempt' ORDER BY 1`,
    );
    expect(columnas.map((c) => c.column_name)).toEqual(['attempted_at', 'id', 'ip_hash']);
  });

  it('la tarea purgar-intentos-enlaces borra las filas de más de 24 h y deja las recientes', async () => {
    const vieja = hashDe(ipUnica());
    const reciente = hashDe(ipUnica());
    await poolDe('seed').query(
      `INSERT INTO action_link_attempt (ip_hash, attempted_at)
       VALUES ($1, now() - interval '25 hours'), ($1, now() - interval '24 hours 1 minute'),
              ($2, now() - interval '23 hours'), ($2, now())`,
      [vieja, reciente],
    );
    const corrida = await prueba.app.get(EjecutorTareas).ejecutarAhora('purgar-intentos-enlaces');
    expect(corrida).toMatchObject({ ejecutada: true });
    const cuenta = async (hash: string) =>
      (
        await poolDe('seed').query(
          'SELECT count(*)::int AS total FROM action_link_attempt WHERE ip_hash = $1',
          [hash],
        )
      ).rows[0].total;
    expect(await cuenta(vieja)).toBe(0);
    expect(await cuenta(reciente)).toBe(2);
  });

  it('el límite general de las rutas de enlaces: 30 solicitudes por minuto por IP → la 31.ª recibe 429', async () => {
    const ip = ipUnica();
    const c = await citaConEnlaces(prueba, e, 330);
    const token = c.enlace('CONFIRMAR');
    const estados: number[] = [];
    for (let i = 0; i < 31; i += 1) {
      estados.push((await solicitudDeEnlace(prueba, 'consultar', token, ip)).status);
    }
    expect(estados.slice(0, 30).every((estado) => estado === 200)).toBe(true);
    expect(estados[30]).toBe(429);
  });
});
