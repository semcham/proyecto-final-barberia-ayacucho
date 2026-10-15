import { randomBytes } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato } from '../helpers/contrato';
import { cerrarPools } from '../helpers/test-db';
import { crearEscenario, type Escenario } from '../helpers/sesiones';

// T098 · Contrato de /usuarios, /usuarios/{id}, /usuarios/{id}/activacion y /auth/activar.

const correoNuevo = () => `barbero-${randomBytes(4).toString('hex')}@prueba.pe`;
const tokenDelEnlace = (enlace: string) => new URL(enlace).searchParams.get('token') as string;

describe('Contrato: /usuarios y /auth/activar', () => {
  let prueba: AppDePrueba;
  let escenario: Escenario;
  const conPropietario = () => ({ Authorization: `Bearer ${escenario.tokenPropietario}` });

  beforeAll(async () => {
    prueba = await crearApp();
    escenario = await crearEscenario();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET /usuarios 200 PaginaUsuarios', async () => {
    const respuesta = await prueba.agente.get('/api/v1/usuarios').set(conPropietario()).expect(200);
    expect(erroresDeContrato('/usuarios', 'get', 200, respuesta.body)).toEqual([]);
    expect(respuesta.body).toMatchObject({ total: 3, pagina: 1, tamano: 20 });
  });

  it('POST /usuarios 201 UsuarioCreadoResponse', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/usuarios')
      .set(conPropietario())
      .send({ nombre: 'Luis Barbero', correo: correoNuevo(), rol: 'BARBERO' })
      .expect(201);
    expect(erroresDeContrato('/usuarios', 'post', 201, respuesta.body)).toEqual([]);
    expect(respuesta.body.usuario).toMatchObject({ rol: 'BARBERO', estado: 'PENDIENTE' });
    expect(respuesta.body.activacion.enlace).toMatch(
      /^http:\/\/localhost:5173\/activar\?token=[A-Za-z0-9_-]{43}$/,
    );
  });

  it('POST /usuarios 400 con un rol distinto de BARBERO', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/usuarios')
      .set(conPropietario())
      .send({ nombre: 'Otro Dueño', correo: correoNuevo(), rol: 'PROPIETARIO' })
      .expect(400);
    expect(erroresDeContrato('/usuarios', 'post', 400, respuesta.body)).toEqual([]);
  });

  it('POST /usuarios 409 con un correo existente', async () => {
    const respuesta = await prueba.agente
      .post('/api/v1/usuarios')
      .set(conPropietario())
      .send({ nombre: 'Repetido', correo: escenario.barberoActivo.correo, rol: 'BARBERO' })
      .expect(409);
    expect(erroresDeContrato('/usuarios', 'post', 409, respuesta.body)).toEqual([]);
  });

  it('GET /usuarios/{id} 200 y 404', async () => {
    const respuesta = await prueba.agente
      .get(`/api/v1/usuarios/${escenario.barberoActivo.id}`)
      .set(conPropietario())
      .expect(200);
    expect(erroresDeContrato('/usuarios/{id}', 'get', 200, respuesta.body)).toEqual([]);
    const noExiste = await prueba.agente
      .get('/api/v1/usuarios/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')
      .set(conPropietario())
      .expect(404);
    expect(erroresDeContrato('/usuarios/{id}', 'get', 404, noExiste.body)).toEqual([]);
  });

  it('PATCH /usuarios/{id} 200 y 422 sobre sí mismo', async () => {
    const otro = await crearEscenario();
    const respuesta = await prueba.agente
      .patch(`/api/v1/usuarios/${otro.barberoActivo.id}`)
      .set({ Authorization: `Bearer ${otro.tokenPropietario}` })
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    expect(erroresDeContrato('/usuarios/{id}', 'patch', 200, respuesta.body)).toEqual([]);
    expect(respuesta.body.estado).toBe('DESACTIVADA');

    const propio = await prueba.agente
      .patch(`/api/v1/usuarios/${otro.barberia.propietarioId}`)
      .set({ Authorization: `Bearer ${otro.tokenPropietario}` })
      .send({ estado: 'DESACTIVADA' })
      .expect(422);
    expect(erroresDeContrato('/usuarios/{id}', 'patch', 422, propio.body)).toEqual([]);
  });

  it('POST /usuarios/{id}/activacion 201 EnlaceActivacion y 422 si ya está activo', async () => {
    const respuesta = await prueba.agente
      .post(`/api/v1/usuarios/${escenario.barberoPendiente.id}/activacion`)
      .set(conPropietario())
      .expect(201);
    expect(erroresDeContrato('/usuarios/{id}/activacion', 'post', 201, respuesta.body)).toEqual([]);
    const activo = await prueba.agente
      .post(`/api/v1/usuarios/${escenario.barberoActivo.id}/activacion`)
      .set(conPropietario())
      .expect(422);
    expect(erroresDeContrato('/usuarios/{id}/activacion', 'post', 422, activo.body)).toEqual([]);
  });

  it('POST /auth/activar 204 y 400 ENLACE_INVALIDO', async () => {
    const creado = await prueba.agente
      .post('/api/v1/usuarios')
      .set(conPropietario())
      .send({ nombre: 'Para Activar', correo: correoNuevo(), rol: 'BARBERO' })
      .expect(201);
    const token = tokenDelEnlace(creado.body.activacion.enlace);
    await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: 'una clave larga y propia' })
      .expect(204);
    const invalido = await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: 'una clave larga y propia' })
      .expect(400);
    expect(erroresDeContrato('/auth/activar', 'post', 400, invalido.body)).toEqual([]);
    expect(invalido.body.codigo).toBe('ENLACE_INVALIDO');
  });
});
