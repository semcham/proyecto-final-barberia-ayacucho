import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato } from '../helpers/contrato';
import { type BarberiaSembrada, sembrarBarberia } from '../helpers/fixtures';
import { cerrarPools } from '../helpers/test-db';

// T074 · Contrato de /auth/login, /auth/refresh, /auth/logout y /auth/yo (contracts/openapi.yaml).

function cookieRenovacion(encabezados: Record<string, unknown>): string | undefined {
  return ([] as string[])
    .concat((encabezados['set-cookie'] as string[]) ?? [])
    .find((c) => c.startsWith('rt='));
}

describe('Contrato: /auth/*', () => {
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

  async function iniciarSesion() {
    return prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: barberia.correo, contrasena: barberia.contrasena })
      .expect(200);
  }

  it('POST /auth/login 200: cuerpo según contrato y cookie de renovación', async () => {
    const respuesta = await iniciarSesion();
    expect(erroresDeContrato('/auth/login', 'post', 200, respuesta.body)).toEqual([]);
    expect(respuesta.body.usuario).toMatchObject({ id: barberia.propietarioId, rol: 'PROPIETARIO' });
    expect(respuesta.body.usuario.barberia.id).toBe(barberia.tenantId);
    expect(cookieRenovacion(respuesta.headers)).toMatch(/HttpOnly.*|.*HttpOnly/i);
  });

  it('POST /auth/login 401 CREDENCIALES_INVALIDAS', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: barberia.correo, contrasena: 'no-es-la-contrasena' })
      .expect(401);
    expect(erroresDeContrato('/auth/login', 'post', 401, respuesta.body)).toEqual([]);
    expect(respuesta.body.codigo).toBe('CREDENCIALES_INVALIDAS');
  });

  it('POST /auth/login 400 VALIDACION sin contraseña', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: barberia.correo })
      .expect(400);
    expect(erroresDeContrato('/auth/login', 'post', 400, respuesta.body)).toEqual([]);
  });

  it('POST /auth/refresh 200 con la cookie y rota la cookie', async () => {
    const login = await iniciarSesion();
    const cookie = cookieRenovacion(login.headers) as string;
    const respuesta = await prueba.agente
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie.split(';')[0])
      .expect(200);
    expect(erroresDeContrato('/auth/refresh', 'post', 200, respuesta.body)).toEqual([]);
    expect(cookieRenovacion(respuesta.headers)?.split(';')[0]).not.toBe(cookie.split(';')[0]);
  });

  it('POST /auth/refresh 401 sin cookie', async () => {
    const respuesta = await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', '').expect(401);
    expect(erroresDeContrato('/auth/refresh', 'post', 401, respuesta.body)).toEqual([]);
  });

  it('GET /auth/yo 200 según contrato y 401 sin token', async () => {
    const { body } = await iniciarSesion();
    const respuesta = await prueba.agente
      .get('/api/v1/auth/yo')
      .set('Authorization', `Bearer ${body.tokenAcceso}`)
      .expect(200);
    expect(erroresDeContrato('/auth/yo', 'get', 200, respuesta.body)).toEqual([]);
    expect(respuesta.body.barberia.id).toBe(barberia.tenantId);

    const sinToken = await prueba.agente.get('/api/v1/auth/yo').expect(401);
    expect(erroresDeContrato('/auth/yo', 'get', 401, sinToken.body)).toEqual([]);
  });

  it('POST /auth/logout 204 y borra la cookie', async () => {
    const { body } = await iniciarSesion();
    const respuesta = await prueba.agente
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${body.tokenAcceso}`)
      .expect(204);
    expect(cookieRenovacion(respuesta.headers)).toMatch(/Expires=Thu, 01 Jan 1970/);
  });
});
