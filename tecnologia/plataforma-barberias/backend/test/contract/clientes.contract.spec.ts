import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002, erroresDeContrato004 } from '../helpers/contrato';
import { type BarberiaSembrada, sembrarBarberia, sembrarCliente } from '../helpers/fixtures';
import { sesionCliente, tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T081 · Contrato (specs/002-catalogo-citas-cliente/contracts/openapi.yaml) de POST /clientes/registro,
// POST /auth/login con enlace y aceptación, y POST /auth/barberia.

const VERSION = '2026-10';

describe('Contrato 002: cuenta de cliente', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia();
    b = await sembrarBarberia();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('POST /clientes/registro 201, 400, 404 y 409 según el contrato', async () => {
    const cuerpo = {
      barberia: a.slug,
      nombre: 'Luz Contrato',
      correo: `luz-${Date.now()}@prueba.pe`,
      telefono: '966000111',
      contrasena: 'clave-de-luz-segura',
      aceptaPoliticaDatos: true,
      versionPoliticaDatos: VERSION,
    };
    const creado = await prueba.agente.post('/api/v1/clientes/registro').send(cuerpo).expect(201);
    expect(erroresDeContrato002('/clientes/registro', 'post', 201, creado.body)).toEqual([]);

    const repetido = await prueba.agente.post('/api/v1/clientes/registro').send(cuerpo).expect(409);
    expect(erroresDeContrato002('/clientes/registro', 'post', 409, repetido.body)).toEqual([]);

    const invalido = await prueba.agente
      .post('/api/v1/clientes/registro')
      .send({ ...cuerpo, correo: `otro-${Date.now()}@prueba.pe`, telefono: 'x' })
      .expect(400);
    expect(erroresDeContrato002('/clientes/registro', 'post', 400, invalido.body)).toEqual([]);

    const sinBarberia = await prueba.agente
      .post('/api/v1/clientes/registro')
      .send({ ...cuerpo, correo: `otro2-${Date.now()}@prueba.pe`, barberia: 'no-existe' })
      .expect(404);
    expect(erroresDeContrato002('/clientes/registro', 'post', 404, sinBarberia.body)).toEqual([]);
  });

  it('POST /auth/login con enlace: 200 y 409 según el contrato', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    const credenciales = { correo: cliente.correo, contrasena: cliente.contrasena };
    const ok = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ ...credenciales, barberia: a.slug })
      .expect(200);
    expect(erroresDeContrato002('/auth/login', 'post', 200, ok.body)).toEqual([]);
    const unirse = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ ...credenciales, barberia: b.slug })
      .expect(409);
    expect(erroresDeContrato002('/auth/login', 'post', 409, unirse.body)).toEqual([]);
    const union = await prueba.agente
      .post('/api/v1/auth/login')
      .send({
        ...credenciales,
        barberia: b.slug,
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: VERSION,
        telefono: '955123123',
      })
      .expect(200);
    expect(erroresDeContrato002('/auth/login', 'post', 200, union.body)).toEqual([]);
    expect(union.body.usuario.rol).toBe('CLIENTE');
  });

  it('POST /auth/barberia: 200, 403, 404 y 409 según el contrato', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    await sembrarCliente({ tenantId: b.tenantId, usuarioId: cliente.usuarioId as string });
    const token = await tokenPara(a.tenantId, cliente.usuarioId as string, 'CLIENTE');
    const ok = await prueba.agente
      .post('/api/v1/auth/barberia')
      .set({ Authorization: `Bearer ${token}` })
      .send({ barberia: b.slug })
      .expect(200);
    expect(erroresDeContrato002('/auth/barberia', 'post', 200, ok.body)).toEqual([]);

    const otro = await sembrarCliente({ tenantId: a.tenantId });
    const tokenOtro = await tokenPara(a.tenantId, otro.usuarioId as string, 'CLIENTE');
    const conflicto = await prueba.agente
      .post('/api/v1/auth/barberia')
      .set({ Authorization: `Bearer ${tokenOtro}` })
      .send({ barberia: b.slug })
      .expect(409);
    expect(erroresDeContrato002('/auth/barberia', 'post', 409, conflicto.body)).toEqual([]);
    const noDisponible = await prueba.agente
      .post('/api/v1/auth/barberia')
      .set({ Authorization: `Bearer ${tokenOtro}` })
      .send({ barberia: 'no-existe' })
      .expect(404);
    expect(erroresDeContrato002('/auth/barberia', 'post', 404, noDisponible.body)).toEqual([]);

    const tokenPropietario = await tokenPara(a.tenantId, a.propietarioId, 'PROPIETARIO');
    const prohibido = await prueba.agente
      .post('/api/v1/auth/barberia')
      .set({ Authorization: `Bearer ${tokenPropietario}` })
      .send({ barberia: b.slug })
      .expect(403);
    expect(erroresDeContrato002('/auth/barberia', 'post', 403, prohibido.body)).toEqual([]);
  });

  // T110 (004, RF33): GET y PUT /clientes/yo/aviso según specs/004-notificaciones-reprogramacion/contracts/openapi.yaml
  // (PreferenciaAviso; 422 VALIDACION o CONSENTIMIENTO_REQUERIDO). DELETE responde 204 sin cuerpo.
  it('GET y PUT /clientes/yo/aviso (004): 200 con PreferenciaAviso, 422; DELETE 204', async () => {
    const { token } = await sesionCliente(a.tenantId);
    const como = { Authorization: `Bearer ${token}` };
    const ruta = '/api/v1/clientes/yo/aviso';
    const leida = await prueba.agente.get(ruta).set(como).expect(200);
    expect(erroresDeContrato004('/clientes/yo/aviso', 'get', 200, leida.body)).toEqual([]);

    const guardada = await prueba.agente
      .put(ruta)
      .set(como)
      .send({
        canal: 'WHATSAPP',
        numeroWhatsapp: '+51 987 654 321',
        aceptaWhatsapp: true,
        versionTexto: '2026-11',
      })
      .expect(200);
    expect(erroresDeContrato004('/clientes/yo/aviso', 'put', 200, guardada.body)).toEqual([]);

    const sinAceptar = await prueba.agente
      .put(ruta)
      .set(como)
      .send({ canal: 'WHATSAPP', numeroWhatsapp: '+51 900 111 222' })
      .expect(422);
    expect(erroresDeContrato004('/clientes/yo/aviso', 'put', 422, sinAceptar.body)).toEqual([]);
    const invalido = await prueba.agente
      .put(ruta)
      .set(como)
      .send({ canal: 'WHATSAPP', numeroWhatsapp: 'abc', aceptaWhatsapp: true, versionTexto: '2026-11' })
      .expect(422);
    expect(erroresDeContrato004('/clientes/yo/aviso', 'put', 422, invalido.body)).toEqual([]);

    const retiro = await prueba.agente.delete(`${ruta}/consentimiento-whatsapp`).set(como).expect(204);
    expect(retiro.text).toBe('');
  });
});
