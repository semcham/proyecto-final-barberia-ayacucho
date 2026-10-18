import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002 } from '../helpers/contrato';
import { sembrarCita, sembrarCliente, sembrarUsuario } from '../helpers/fixtures';
import { type BarberiaParaReservar, barberiaParaReservar, fechaEnDias, horaLima } from '../helpers/reservas';
import { tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T101 · Contrato (specs/002-catalogo-citas-cliente/contracts/openapi.yaml) de GET /agenda,
// POST /citas/{id}/estado, GET /clientes y POST /clientes.

describe('Contrato 002: agenda, estados y clientes (US4)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let propietario: string;
  let barbero: string;

  const con = (t: string) => ({ Authorization: `Bearer ${t}` });
  const sin = (cuerpo: unknown, ruta: string, metodo: string, estado: number) =>
    expect(erroresDeContrato002(ruta, metodo, estado, cuerpo)).toEqual([]);
  const citaEn = async (fecha: string, hora: string) =>
    sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: (await sembrarCliente({ tenantId: e.barberia.tenantId })).clienteId,
      inicio: new Date(horaLima(fecha, hora)),
    });

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const usuario = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    barbero = await tokenPara(e.barberia.tenantId, usuario.usuarioId, 'BARBERO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET /agenda: 200 con Agenda (CitaAgenda), 400, 401 y 403', async () => {
    const fecha = fechaEnDias(2);
    await citaEn(fecha, '10:00');
    const ok = await prueba.agente.get(`/api/v1/agenda?fecha=${fecha}`).set(con(propietario)).expect(200);
    sin(ok.body, '/agenda', 'get', 200);
    expect(ok.body.citas).toHaveLength(1);
    sin(
      (await prueba.agente.get('/api/v1/agenda?fecha=x').set(con(propietario)).expect(400)).body,
      '/agenda',
      'get',
      400,
    );
    sin((await prueba.agente.get(`/api/v1/agenda?fecha=${fecha}`).expect(401)).body, '/agenda', 'get', 401);
    // Barbero sin vínculo con un barbero del catálogo.
    sin(
      (await prueba.agente.get(`/api/v1/agenda?fecha=${fecha}`).set(con(barbero)).expect(403)).body,
      '/agenda',
      'get',
      403,
    );
  });

  it('POST /citas/{id}/estado: 200 con Cita, 400, 404 y 422', async () => {
    const pasada = await citaEn(fechaEnDias(-1), '10:00');
    const ruta = (id: string) => `/api/v1/citas/${id}/estado`;
    const ok = await prueba.agente
      .post(ruta(pasada))
      .set(con(propietario))
      .send({ estado: 'COMPLETADA' })
      .expect(200);
    sin(ok.body, '/citas/{id}/estado', 'post', 200);
    const invalida = await prueba.agente
      .post(ruta(pasada))
      .set(con(propietario))
      .send({ estado: 'NO_ASISTIO' })
      .expect(422);
    sin(invalida.body, '/citas/{id}/estado', 'post', 422);
    sin(
      (await prueba.agente.post(ruta(pasada)).set(con(propietario)).send({ estado: 'X' }).expect(400)).body,
      '/citas/{id}/estado',
      'post',
      400,
    );
    const noHay = await prueba.agente
      .post(ruta('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'))
      .set(con(propietario))
      .send({ estado: 'COMPLETADA' })
      .expect(404);
    sin(noHay.body, '/citas/{id}/estado', 'post', 404);
  });

  it('GET y POST /clientes: 200 con ClienteResumen[], 201 con ClienteResumen, 400 y 403', async () => {
    const creado = await prueba.agente
      .post('/api/v1/clientes')
      .set(con(propietario))
      .send({
        nombre: 'Cliente Contrato',
        telefono: '900111222',
        consentimientoVerbal: true,
        versionPoliticaDatos: '2026-10',
      })
      .expect(201);
    sin(creado.body, '/clientes', 'post', 201);
    const malo = await prueba.agente
      .post('/api/v1/clientes')
      .set(con(propietario))
      .send({ nombre: 'Sin Consentimiento', telefono: '900111222', versionPoliticaDatos: '2026-10' })
      .expect(400);
    sin(malo.body, '/clientes', 'post', 400);
    sin(
      (await prueba.agente.get('/api/v1/clientes?buscar=contrato').set(con(propietario)).expect(200)).body,
      '/clientes',
      'get',
      200,
    );
    sin(
      (await prueba.agente.get('/api/v1/clientes?buscar=contrato').set(con(barbero)).expect(403)).body,
      '/clientes',
      'get',
      403,
    );
  });
});
