import { randomBytes } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato } from '../helpers/contrato';
import { cerrarPools } from '../helpers/test-db';

// T057 · Contrato de POST /api/v1/barberias (contracts/openapi.yaml).

const RUTA = '/api/v1/barberias';

function registroValido(correo = `dueno-${randomBytes(4).toString('hex')}@prueba.pe`) {
  return {
    nombreBarberia: 'Barbería Huamanga',
    propietario: { nombre: 'Rosa Quispe', correo, contrasena: 'mi barberia en huamanga' },
    aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
  };
}

describe('Contrato: POST /barberias', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('201: cuerpo según el contrato y cookie de renovación segura', async () => {
    const respuesta = await prueba.agente.post(RUTA).send(registroValido()).expect(201);
    expect(erroresDeContrato('/barberias', 'post', 201, respuesta.body)).toEqual([]);
    expect(respuesta.body.suscripcion.estado).toBe('TRIAL');
    expect(respuesta.body.sesion.usuario.rol).toBe('PROPIETARIO');
    // El token de renovación nunca va en el cuerpo.
    expect(JSON.stringify(respuesta.body)).not.toMatch(/tokenRenovacion|refresh/i);

    const cookies = ([] as string[]).concat(respuesta.headers['set-cookie'] ?? []);
    const cookie = cookies.find((valor) => valor.startsWith('rt='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
  });

  it.each([
    ['correo con formato inválido', { propietario: { correo: 'sin-arroba' } }],
    ['contraseña corta', { propietario: { contrasena: 'corta' } }],
    ['nombre de barbería vacío', { nombreBarberia: '' }],
    ['nombre de barbería demasiado largo', { nombreBarberia: 'x'.repeat(121) }],
    ['sin aceptaciones', { aceptaciones: undefined }],
  ])('400 VALIDACION: %s', async (_caso, cambio) => {
    const base = registroValido();
    const cuerpo = {
      ...base,
      ...cambio,
      propietario: { ...base.propietario, ...(cambio as { propietario?: object }).propietario },
    };
    const respuesta = await prueba.agente.post(RUTA).send(cuerpo).expect(400);
    expect(erroresDeContrato('/barberias', 'post', 400, respuesta.body)).toEqual([]);
    expect(respuesta.body.codigo).toBe('VALIDACION');
  });

  it.each(['tenantId', 'tenant_id', 'barberiaId'])('400 VALIDACION si el cuerpo trae %s', async (campo) => {
    const respuesta = await prueba.agente
      .post(RUTA)
      .send({ ...registroValido(), [campo]: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' })
      .expect(400);
    expect(respuesta.body.codigo).toBe('VALIDACION');
    expect(respuesta.body.detalles).toEqual(
      expect.arrayContaining([expect.objectContaining({ campo, problema: 'no_permitido' })]),
    );
  });

  it('409 CORREO_NO_DISPONIBLE sin revelar la barbería del correo', async () => {
    const correo = `repetido-${randomBytes(4).toString('hex')}@prueba.pe`;
    await prueba.agente
      .post(RUTA)
      .send({ ...registroValido(correo), nombreBarberia: 'Barbería Secreta' })
      .expect(201);
    const respuesta = await prueba.agente.post(RUTA).send(registroValido(correo)).expect(409);
    expect(erroresDeContrato('/barberias', 'post', 409, respuesta.body)).toEqual([]);
    expect(respuesta.body.codigo).toBe('CORREO_NO_DISPONIBLE');
    expect(JSON.stringify(respuesta.body)).not.toContain('Secreta');
  });
});
