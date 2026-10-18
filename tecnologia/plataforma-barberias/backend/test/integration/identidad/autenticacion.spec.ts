import { decodeJwt } from 'jose';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaSembrada,
  filasDe,
  sembrarBarberia,
  sembrarCliente,
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

    it('cuenta solo de cliente (ADR-020): con contraseña errada, el mismo 401; con la correcta, debe ingresar desde su barbería', async () => {
      const cliente = await sembrarCliente({ tenantId: barberia.tenantId });
      const errada = await login(cliente.correo as string, 'otra-clave-cualquiera').expect(401);
      expect(errada.body).toEqual({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Correo o contraseña incorrectos.',
        detalles: [],
      });
      const correcta = await login(cliente.correo as string, cliente.contrasena as string).expect(409);
      expect(correcta.body.codigo).toBe('INGRESA_DESDE_TU_BARBERIA');
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

  describe('rotación del token de renovación y período de gracia (FR-008a, T123)', () => {
    const renovar = (cookie: string) => prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie);

    /** Inicia sesión en una barbería nueva (auditoría aislada) y renueva una vez: cookie1 → cookie2. */
    async function sesionRotada() {
      const propia = await sembrarBarberia();
      const inicio = await login(propia.correo, propia.contrasena).expect(200);
      const cookie1 = cookieDe(inicio.headers);
      const sid = decodeJwt(inicio.body.tokenAcceso).sid as string;
      const renovada = await renovar(cookie1).expect(200);
      const cookie2 = cookieDe(renovada.headers);
      expect(cookie2).not.toBe(cookie1);
      expect(decodeJwt(renovada.body.tokenAcceso).sid).toBe(sid);
      return { propia, sid, cookie1, cookie2, tokenAcceso: renovada.body.tokenAcceso as string };
    }

    const sesionEnBase = async (tenantId: string, sid: string) =>
      (await filasDe('auth_session', tenantId)).find((fila) => fila.id === sid);
    const acciones = async (tenantId: string) =>
      (await filasDe('audit_log', tenantId)).map((fila) => fila.action);

    /** Simula que la rotación ocurrió hace `segundos` (sin esperar en la prueba). */
    async function retrasarRotacion(sid: string, segundos: number) {
      await poolDe('seed').query(
        `UPDATE auth_session SET rotated_at = rotated_at - make_interval(secs => $2) WHERE id = $1`,
        [sid, segundos],
      );
    }

    it('recarga doble: la cookie anterior dentro de la ventana se acepta una vez y la sesión sigue activa', async () => {
      // La respuesta de la primera renovación "se pierde": el navegador sigue con cookie1.
      const { propia, sid, cookie1 } = await sesionRotada();

      const repetida = await renovar(cookie1).expect(200);
      const cookie3 = cookieDe(repetida.headers);
      await renovar(cookie3).expect(200);

      expect((await sesionEnBase(propia.tenantId, sid))?.status).toBe('ACTIVA');
      const registradas = await acciones(propia.tenantId);
      expect(registradas).not.toContain('SESION_REUTILIZADA');
      expect(registradas.filter((accion) => accion === 'SESION_RENOVADA_EN_GRACIA')).toHaveLength(1);
    });

    it('robo real: la cookie anterior fuera de la ventana revoca la sesión y queda auditado', async () => {
      const { propia, sid, cookie1, cookie2, tokenAcceso } = await sesionRotada();
      await retrasarRotacion(sid, 11);

      await renovar(cookie1).expect(401);
      // La sesión quedó revocada: ni la cookie vigente ni el token de acceso sirven ya.
      await renovar(cookie2).expect(401);
      await prueba.agente.get('/api/v1/auth/yo').set('Authorization', `Bearer ${tokenAcceso}`).expect(401);

      expect((await sesionEnBase(propia.tenantId, sid))?.status).toBe('REVOCADA');
      expect(await filasDe('audit_log', propia.tenantId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ action: 'SESION_REUTILIZADA', actor_id: propia.propietarioId }),
        ]),
      );
    });

    it('doble reutilización: el segundo uso de la cookie anterior dentro de la ventana revoca la sesión', async () => {
      const { propia, sid, cookie1 } = await sesionRotada();

      const enGracia = await renovar(cookie1).expect(200);
      await renovar(cookie1).expect(401);
      await renovar(cookieDe(enGracia.headers)).expect(401);

      expect((await sesionEnBase(propia.tenantId, sid))?.status).toBe('REVOCADA');
      expect(await acciones(propia.tenantId)).toContain('SESION_REUTILIZADA');
    });

    it('robo dentro de la ventana: si el titular presenta la cookie que la gracia dejó sin efecto, se revoca', async () => {
      const { propia, sid, cookie1, cookie2 } = await sesionRotada();

      // Un atacante usa la cookie anterior en la ventana; el titular legítimo conserva cookie2.
      const atacante = await renovar(cookie1).expect(200);
      await renovar(cookie2).expect(401);
      await renovar(cookieDe(atacante.headers)).expect(401);

      expect((await sesionEnBase(propia.tenantId, sid))?.status).toBe('REVOCADA');
      expect(await acciones(propia.tenantId)).toContain('SESION_REUTILIZADA');
    });

    it('dos renovaciones simultáneas con la misma cookie se atienden en orden y no revocan la sesión', async () => {
      const propia = await sembrarBarberia();
      const inicio = await login(propia.correo, propia.contrasena).expect(200);
      const cookie = cookieDe(inicio.headers);
      const sid = decodeJwt(inicio.body.tokenAcceso).sid as string;

      const respuestas = await Promise.all([renovar(cookie), renovar(cookie)]);

      expect(respuestas.map((respuesta) => respuesta.status)).toEqual([200, 200]);
      expect((await sesionEnBase(propia.tenantId, sid))?.status).toBe('ACTIVA');
      expect(await acciones(propia.tenantId)).not.toContain('SESION_REUTILIZADA');
    });
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
