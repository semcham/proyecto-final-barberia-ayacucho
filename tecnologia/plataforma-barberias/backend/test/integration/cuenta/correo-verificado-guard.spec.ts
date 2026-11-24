import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { ipUnica } from '../../helpers/enlaces';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T050 de 010 · Guard del correo verificado (research R05; FR-009 a FR-011):
// - un cliente sin verificar recibe 403 CORREO_NO_VERIFICADO en POST /citas, POST /asistente/mensajes y
//   POST /citas/{id}/adelanto/pago; verificado, pasa (lo que responda después ya no es el guard);
// - el propietario (cita presencial y asistente) no se ve afectado aunque su correo no esté verificado;
// - el estado se lee en cada solicitud con la barbería del token (PR09): verificar vale al instante.
//
// El guard corre antes de validar el cuerpo, así que basta un cuerpo vacío para ver su decisión.

const RUTAS = [
  ['POST /citas', () => '/api/v1/citas'],
  ['POST /asistente/mensajes', () => '/api/v1/asistente/mensajes'],
  ['POST /citas/{id}/adelanto/pago', () => `/api/v1/citas/${randomUUID()}/adelanto/pago`],
] as const;

describe('Guard del correo verificado (T050 de 010)', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  const enviar = (ruta: string, token: string) =>
    request(prueba.app.getHttpServer())
      .post(ruta)
      .set({ Authorization: `Bearer ${token}`, 'X-Forwarded-For': ipUnica() })
      .send({});

  const marcarSinVerificar = (usuarioId: string) =>
    poolDe('seed').query(
      'UPDATE user_account SET email_verified_at = NULL, email_verified_via = NULL WHERE id = $1',
      [usuarioId],
    );

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia({ nombre: 'Barbería Guard A' });
    b = await sembrarBarberia({ nombre: 'Barbería Guard B' });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it.each(RUTAS)('%s: cliente sin verificar → 403 CORREO_NO_VERIFICADO', async (_nombre, ruta) => {
    const { token } = await sesionCliente(a.tenantId, undefined, { verificado: false });
    const respuesta = await enviar(ruta(), token).expect(403);
    expect(respuesta.body.codigo).toBe('CORREO_NO_VERIFICADO');
  });

  it.each(RUTAS)('%s: cliente verificado → el guard deja pasar', async (_nombre, ruta) => {
    const { token } = await sesionCliente(a.tenantId);
    const respuesta = await enviar(ruta(), token);
    expect(respuesta.body.codigo).not.toBe('CORREO_NO_VERIFICADO');
  });

  it.each(RUTAS.slice(0, 2))(
    '%s: el propietario no se ve afectado aunque su correo no esté verificado',
    async (_nombre, ruta) => {
      await marcarSinVerificar(a.propietarioId);
      const token = await tokenPara(a.tenantId, a.propietarioId, 'PROPIETARIO');
      const respuesta = await enviar(ruta(), token);
      expect(respuesta.status).not.toBe(403);
      expect(respuesta.body.codigo).not.toBe('CORREO_NO_VERIFICADO');
    },
  );

  it('verificar vale al instante con la misma sesión, y en cualquier barbería del cliente (tenant del token)', async () => {
    const { cliente, token: tokenA } = await sesionCliente(a.tenantId, undefined, { verificado: false });
    const usuarioId = cliente.usuarioId as string;
    await sembrarCliente({ tenantId: b.tenantId, usuarioId });
    const tokenB = await tokenPara(b.tenantId, usuarioId, 'CLIENTE');

    for (const token of [tokenA, tokenB]) {
      expect((await enviar('/api/v1/citas', token).expect(403)).body.codigo).toBe('CORREO_NO_VERIFICADO');
    }
    await poolDe('seed').query(
      `UPDATE user_account SET email_verified_at = now(), email_verified_via = 'ENLACE' WHERE id = $1`,
      [usuarioId],
    );
    for (const token of [tokenA, tokenB]) {
      expect((await enviar('/api/v1/citas', token)).body.codigo).not.toBe('CORREO_NO_VERIFICADO');
    }
  });
  // Un token de B para alguien sin membresía en B no puede existir: auth_session exige la membresía (FK), y el AuthGuard
  // comprueba la sesión. El guard lee siempre con la barbería del token (arriba, con A y con B).
});
