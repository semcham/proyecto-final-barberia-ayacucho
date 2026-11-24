import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002, erroresDeContrato010, erroresDeEsquema010 } from '../helpers/contrato';
import { ipUnica } from '../helpers/enlaces';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../helpers/fixtures';
import { sesionCliente } from '../helpers/sesiones';
import { cerrarPools, poolDe } from '../helpers/test-db';

// T048 de 010 · Contrato (specs/010-acceso-verificado/contracts/openapi.yaml) de POST /cuenta/verificacion y
// POST /cuenta/verificacion/reenvio, y `correoVerificado` en el usuario de SesionResponse (login, /auth/yo y registro;
// contratos de 001 y 002, que lo agregan en la fase 4).

const VERSION = process.env.PRIVACY_POLICY_VERSION as string;

describe('Contrato 010: verificación del correo', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Un enlace de verificación vigente con un token conocido (como si ya se hubiera enviado el correo). */
  async function enlaceVigente(usuarioId: string): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    await poolDe('seed').query(
      `INSERT INTO account_link (id, tenant_id, user_id, purpose, token_hash, requested_at, expires_at)
       VALUES ($1, $2, $3, 'VERIFICAR_CORREO', $4, now(), now() + interval '24 hours')`,
      [uuidv7(), a.tenantId, usuarioId, createHash('sha256').update(token).digest('hex')],
    );
    return token;
  }

  const verificar = (token: string, ip = ipUnica()) =>
    prueba.agente.post('/api/v1/cuenta/verificacion').set('X-Forwarded-For', ip).send({ token });

  it('POST /cuenta/verificacion: 200 { barberia }, 410 y 429 según el contrato', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId, verificado: false });
    const token = await enlaceVigente(cliente.usuarioId as string);
    const ok = await verificar(token).expect(200);
    expect(erroresDeContrato010('/cuenta/verificacion', 'post', 200, ok.body)).toEqual([]);
    expect(ok.body).toEqual({ barberia: a.slug });

    const usado = await verificar(token).expect(410);
    expect(erroresDeContrato010('/cuenta/verificacion', 'post', 410, usado.body)).toEqual([]);
    expect(usado.body.codigo).toBe('ENLACE_NO_VALIDO');

    const ip = ipUnica();
    for (let i = 0; i < 20; i++) await verificar(randomBytes(32).toString('base64url'), ip).expect(410);
    const limite = await verificar(randomBytes(32).toString('base64url'), ip).expect(429);
    expect(erroresDeContrato010('/cuenta/verificacion', 'post', 429, limite.body)).toEqual([]);
    expect(limite.body.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(limite.headers['retry-after']).toEqual(expect.any(String));
  });

  it('POST /cuenta/verificacion/reenvio: 202 neutra, 401 sin sesión y 429 según el contrato', async () => {
    const { token } = await sesionCliente(a.tenantId, undefined, { verificado: false });
    const ip = ipUnica();
    const reenviar = () =>
      prueba.agente
        .post('/api/v1/cuenta/verificacion/reenvio')
        .set({ Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip });
    for (let i = 0; i < 3; i++) {
      const neutra = await reenviar().expect(202);
      expect(erroresDeContrato010('/cuenta/verificacion/reenvio', 'post', 202, neutra.body)).toEqual([]);
    }
    const limite = await reenviar().expect(429);
    expect(erroresDeContrato010('/cuenta/verificacion/reenvio', 'post', 429, limite.body)).toEqual([]);
    await prueba.agente.post('/api/v1/cuenta/verificacion/reenvio').expect(401);
  });

  it('SesionResponse.usuario lleva correoVerificado (registro, login con enlace y /auth/yo)', async () => {
    const registro = await prueba.agente
      .post('/api/v1/clientes/registro')
      .set('X-Forwarded-For', ipUnica())
      .send({
        barberia: a.slug,
        nombre: 'Rosa Contrato',
        correo: `rosa-${Date.now()}@prueba.pe`,
        telefono: '966000222',
        contrasena: 'clave-de-rosa-segura',
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: VERSION,
      })
      .expect(201);
    expect(erroresDeContrato002('/clientes/registro', 'post', 201, registro.body)).toEqual([]);
    expect(erroresDeEsquema010('UsuarioSesion', registro.body.usuario)).toEqual([]);
    expect(registro.body.usuario.correoVerificado).toBe(false);

    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    const login = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: cliente.correo, contrasena: cliente.contrasena, barberia: a.slug })
      .expect(200);
    expect(erroresDeContrato002('/auth/login', 'post', 200, login.body)).toEqual([]);
    expect(login.body.usuario.correoVerificado).toBe(true);

    const yo = await prueba.agente
      .get('/api/v1/auth/yo')
      .set('Authorization', `Bearer ${login.body.tokenAcceso}`)
      .expect(200);
    // /auth/yo es de 001, cuyo Rol no incluye CLIENTE: se valida el usuario con el esquema de 010.
    expect(erroresDeEsquema010('UsuarioSesion', yo.body)).toEqual([]);
    expect(yo.body.correoVerificado).toBe(true);
  });
});
