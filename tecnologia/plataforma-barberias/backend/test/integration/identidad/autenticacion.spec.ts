import { decodeJwt } from 'jose';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaSembrada,
  filasDe,
  sembrarBarberia,
  sembrarSesion,
  sembrarSuscripcion,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T075 · PR07: inicio de sesión, renovación y cierre de sesión contra PostgreSQL real.

const DIA_MS = 24 * 60 * 60 * 1000;
const LOGIN = '/api/v1/auth/login';

function cookieDe(encabezados: Record<string, unknown>): string {
  const cookie = ([] as string[])
    .concat((encabezados['set-cookie'] as string[]) ?? [])
    .find((valor) => valor.startsWith('rt='));
  if (!cookie) throw new Error('La respuesta no trae la cookie rt');
  return cookie.split(';')[0];
}

describe('Autenticación (PR07)', () => {
  let prueba: AppDePrueba;
  let barberia: BarberiaSembrada;

  beforeAll(async () => {
    prueba = await crearApp();
    barberia = await sembrarBarberia();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const login = (correo: string, contrasena: string) =>
    prueba.agente.post(LOGIN).send({ correo, contrasena });

  it('emite un token con sub, tid, rol y sid que vence en 900 s', async () => {
    const { body } = await login(barberia.correo, barberia.contrasena).expect(200);
    const reclamaciones = decodeJwt(body.tokenAcceso);
    expect(reclamaciones).toMatchObject({
      sub: barberia.propietarioId,
      tid: barberia.tenantId,
      rol: 'PROPIETARIO',
    });
    expect(typeof reclamaciones.sid).toBe('string');
    expect((reclamaciones.exp as number) - (reclamaciones.iat as number)).toBe(900);
    expect(body.expiraEn).toBe(900);
  });

  it('acepta el correo con mayúsculas y espacios', async () => {
    await login(`  ${barberia.correo.toUpperCase()} `, barberia.contrasena).expect(200);
  });

  describe('mismo 401 CREDENCIALES_INVALIDAS, sin decir qué falló (FR-009)', () => {
    it.each([
      ['correo inexistente', () => ['nadie-existe@prueba.pe', 'clave-de-prueba-segura']],
      ['contraseña errada', () => [barberia.correo, 'otra-clave-cualquiera']],
    ])('%s', async (_caso, datos) => {
      const [correo, contrasena] = datos();
      const { body } = await login(correo, contrasena).expect(401);
      expect(body).toEqual({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Correo o contraseña incorrectos.',
        detalles: [],
      });
    });

    it('cuenta pendiente de activar (sin contraseña)', async () => {
      const pendiente = await sembrarUsuario({
        tenantId: barberia.tenantId,
        rol: 'BARBERO',
        estado: 'PENDIENTE',
        contrasena: null,
      });
      const { body } = await login(pendiente.correo, 'cualquier-clave-larga').expect(401);
      expect(body.codigo).toBe('CREDENCIALES_INVALIDAS');
    });
  });

  it.each([
    [
      'usuario desactivado',
      async () => sembrarUsuario({ tenantId: barberia.tenantId, rol: 'BARBERO', estado: 'DESACTIVADA' }),
    ],
    [
      'barbería suspendida',
      async () => {
        const suspendida = await sembrarBarberia({ estado: 'SUSPENDIDA' });
        return { correo: suspendida.correo, contrasena: suspendida.contrasena };
      },
    ],
  ])('403 ACCESO_SUSPENDIDO sin token: %s (FR-013)', async (_caso, crear) => {
    const { correo, contrasena } = await crear();
    const respuesta = await login(correo, contrasena as string).expect(403);
    expect(respuesta.body.codigo).toBe('ACCESO_SUSPENDIDO');
    expect(respuesta.body.tokenAcceso).toBeUndefined();
    expect(respuesta.headers['set-cookie']).toBeUndefined();
  });

  it('con la prueba gratuita vencida se puede seguir iniciando sesión', async () => {
    const vencida = await sembrarBarberia();
    await sembrarSuscripcion({ tenantId: vencida.tenantId, trialEndsAt: new Date(Date.now() - DIA_MS) });
    await login(vencida.correo, vencida.contrasena).expect(200);
  });

  it('renovar rota la cookie; reutilizar la anterior revoca la sesión y queda auditado', async () => {
    const inicio = await login(barberia.correo, barberia.contrasena).expect(200);
    const cookie1 = cookieDe(inicio.headers);
    const sid = decodeJwt(inicio.body.tokenAcceso).sid as string;

    const renovada = await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie1).expect(200);
    const cookie2 = cookieDe(renovada.headers);
    expect(cookie2).not.toBe(cookie1);
    expect(decodeJwt(renovada.body.tokenAcceso).sid).toBe(sid);

    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie1).expect(401);
    // La sesión quedó revocada: ni la cookie vigente ni el token de acceso sirven ya.
    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie2).expect(401);
    await prueba.agente
      .get('/api/v1/auth/yo')
      .set('Authorization', `Bearer ${renovada.body.tokenAcceso}`)
      .expect(401);

    const sesion = (await filasDe('auth_session', barberia.tenantId)).find((fila) => fila.id === sid);
    expect(sesion?.status).toBe('REVOCADA');
    const auditoria = await filasDe('audit_log', barberia.tenantId);
    expect(auditoria).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'SESION_REUTILIZADA', actor_id: barberia.propietarioId }),
      ]),
    );
  });

  it('tras cerrar sesión, el token de acceso y la cookie dan 401 de inmediato (SC-004)', async () => {
    const inicio = await login(barberia.correo, barberia.contrasena).expect(200);
    const token = inicio.body.tokenAcceso as string;
    const cookie = cookieDe(inicio.headers);
    await prueba.agente.get('/api/v1/auth/yo').set('Authorization', `Bearer ${token}`).expect(200);

    await prueba.agente.post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`).expect(204);

    await prueba.agente.get('/api/v1/auth/yo').set('Authorization', `Bearer ${token}`).expect(401);
    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('al iniciar sesión borra las sesiones terminadas hace más de 30 días y conserva las recientes (R08)', async () => {
    const otra = await sembrarBarberia();
    const vieja = await sembrarSesion({
      tenantId: otra.tenantId,
      usuarioId: otra.propietarioId,
      estado: 'CERRADA',
      terminadaEn: new Date(Date.now() - 31 * DIA_MS),
    });
    const reciente = await sembrarSesion({
      tenantId: otra.tenantId,
      usuarioId: otra.propietarioId,
      estado: 'CERRADA',
      terminadaEn: new Date(Date.now() - 2 * DIA_MS),
    });
    await login(otra.correo, otra.contrasena).expect(200);
    const ids = (await filasDe('auth_session', otra.tenantId)).map((fila) => fila.id);
    expect(ids).not.toContain(vieja.sesionId);
    expect(ids).toContain(reciente.sesionId);
  });

  it('la base guarda las contraseñas solo como cadena Argon2id', async () => {
    const { rows } = await poolDe('seed').query<{ password_hash: string }>(
      'SELECT password_hash FROM user_account WHERE password_hash IS NOT NULL',
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const fila of rows) expect(fila.password_hash).toMatch(/^\$argon2id\$v=19\$/);
  });
});
