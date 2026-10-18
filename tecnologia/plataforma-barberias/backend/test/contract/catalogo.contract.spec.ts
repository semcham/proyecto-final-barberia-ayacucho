import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002 } from '../helpers/contrato';
import { sembrarCita, sembrarCliente, sembrarUsuario } from '../helpers/fixtures';
import { type BarberiaParaReservar, barberiaParaReservar, fechaEnDias, horaLima } from '../helpers/reservas';
import { tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T042 · Contrato (specs/002-catalogo-citas-cliente/contracts/openapi.yaml) de la configuración de la
// barbería (US1): /barberia, /barberia/horario, /servicios, /barberos, disponibilidad y bloqueos.

const ID_INEXISTENTE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';

describe('Contrato 002: configuración de la barbería (US1)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let propietario: string;
  let barbero: string;

  const con = (t: string | null) => (t ? { Authorization: `Bearer ${t}` } : {});
  const sin = (cuerpo: unknown, ruta: string, metodo: string, estado: number) =>
    expect(erroresDeContrato002(ruta, metodo, estado, cuerpo)).toEqual([]);

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

  it('GET y PATCH /barberia', async () => {
    const ruta = '/api/v1/barberia';
    sin((await prueba.agente.get(ruta).set(con(propietario)).expect(200)).body, '/barberia', 'get', 200);
    sin((await prueba.agente.get(ruta).expect(401)).body, '/barberia', 'get', 401);
    const ok = await prueba.agente
      .patch(ruta)
      .set(con(propietario))
      .send({ telefono: '966123456' })
      .expect(200);
    sin(ok.body, '/barberia', 'patch', 200);
    sin(
      (await prueba.agente.patch(ruta).set(con(propietario)).send({}).expect(400)).body,
      '/barberia',
      'patch',
      400,
    );
    sin(
      (await prueba.agente.patch(ruta).set(con(barbero)).send({ telefono: '1234567' }).expect(403)).body,
      '/barberia',
      'patch',
      403,
    );
    const ocupado = await prueba.agente.patch(ruta).set(con(propietario)).send({ slug: 'admin' }).expect(409);
    sin(ocupado.body, '/barberia', 'patch', 409);
  });

  it('GET y PUT /barberia/horario (incluido 409 CONFLICTO_CON_CITAS)', async () => {
    const ruta = '/api/v1/barberia/horario';
    sin((await prueba.agente.get(ruta).set(con(barbero)).expect(200)).body, '/barberia/horario', 'get', 200);
    const malo = await prueba.agente
      .put(ruta)
      .set(con(propietario))
      .send({ tramos: [{ diaSemana: 1, inicio: '12:00', fin: '09:00' }] })
      .expect(400);
    sin(malo.body, '/barberia/horario', 'put', 400);
    sin(
      (await prueba.agente.put(ruta).set(con(barbero)).send({ tramos: [] }).expect(403)).body,
      '/barberia/horario',
      'put',
      403,
    );

    const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
    await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(2), '18:00')),
    });
    const tramos = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio: '09:00', fin: '19:00' }));
    const conflicto = await prueba.agente
      .put(ruta)
      .set(con(propietario))
      .send({ tramos: tramos.map((t) => ({ ...t, fin: '12:00' })) })
      .expect(409);
    sin(conflicto.body, '/barberia/horario', 'put', 409);
    sin(
      (await prueba.agente.put(ruta).set(con(propietario)).send({ tramos }).expect(200)).body,
      '/barberia/horario',
      'put',
      200,
    );
  });

  it('/servicios y /servicios/{id}', async () => {
    sin(
      (await prueba.agente.get('/api/v1/servicios').set(con(barbero)).expect(200)).body,
      '/servicios',
      'get',
      200,
    );
    const creado = await prueba.agente
      .post('/api/v1/servicios')
      .set(con(propietario))
      .send({ nombre: 'Contrato', precio: '12', duracionMinutos: 20 })
      .expect(201);
    sin(creado.body, '/servicios', 'post', 201);
    const repetido = await prueba.agente
      .post('/api/v1/servicios')
      .set(con(propietario))
      .send({ nombre: 'contrato', precio: '12', duracionMinutos: 20 })
      .expect(409);
    sin(repetido.body, '/servicios', 'post', 409);
    sin(
      (await prueba.agente.post('/api/v1/servicios').set(con(propietario)).send({ nombre: 'X' }).expect(400))
        .body,
      '/servicios',
      'post',
      400,
    );
    const editado = await prueba.agente
      .patch(`/api/v1/servicios/${creado.body.id}`)
      .set(con(propietario))
      .send({ precio: '15.5' })
      .expect(200);
    sin(editado.body, '/servicios/{id}', 'patch', 200);
    const noHay = await prueba.agente
      .patch(`/api/v1/servicios/${ID_INEXISTENTE}`)
      .set(con(propietario))
      .send({ precio: '1' })
      .expect(404);
    sin(noHay.body, '/servicios/{id}', 'patch', 404);
  });

  it('/barberos y /barberos/{id}', async () => {
    sin(
      (await prueba.agente.get('/api/v1/barberos').set(con(barbero)).expect(200)).body,
      '/barberos',
      'get',
      200,
    );
    const creado = await prueba.agente
      .post('/api/v1/barberos')
      .set(con(propietario))
      .send({ nombre: 'Contrato', servicioIds: [e.servicioId] })
      .expect(201);
    sin(creado.body, '/barberos', 'post', 201);
    sin(
      (
        await prueba.agente
          .post('/api/v1/barberos')
          .set(con(barbero))
          .send({ nombre: 'No', servicioIds: [] })
          .expect(403)
      ).body,
      '/barberos',
      'post',
      403,
    );
    const editado = await prueba.agente
      .patch(`/api/v1/barberos/${creado.body.id}`)
      .set(con(propietario))
      .send({ nombre: 'Contrato Editado', servicioIds: [] })
      .expect(200);
    sin(editado.body, '/barberos/{id}', 'patch', 200);
    sin(
      (
        await prueba.agente
          .patch(`/api/v1/barberos/${ID_INEXISTENTE}`)
          .set(con(propietario))
          .send({ nombre: 'X y' })
          .expect(404)
      ).body,
      '/barberos/{id}',
      'patch',
      404,
    );
  });

  it('/barberos/{id}/disponibilidad y /barberos/{id}/bloqueos', async () => {
    const disp = `/api/v1/barberos/${e.otroBarberoId}/disponibilidad`;
    sin(
      (await prueba.agente.get(disp).set(con(propietario)).expect(200)).body,
      '/barberos/{id}/disponibilidad',
      'get',
      200,
    );
    const fuera = await prueba.agente
      .put(disp)
      .set(con(propietario))
      .send({ tramos: [{ diaSemana: 1, inicio: '06:00', fin: '10:00' }] })
      .expect(422);
    sin(fuera.body, '/barberos/{id}/disponibilidad', 'put', 422);
    const guardada = await prueba.agente
      .put(disp)
      .set(con(propietario))
      .send({ tramos: [{ diaSemana: 1, inicio: '09:00', fin: '19:00' }] })
      .expect(200);
    sin(guardada.body, '/barberos/{id}/disponibilidad', 'put', 200);
    sin(
      (await prueba.agente.get(disp).set(con(barbero)).expect(403)).body,
      '/barberos/{id}/disponibilidad',
      'get',
      403,
    );

    const bloqueos = `/api/v1/barberos/${e.otroBarberoId}/bloqueos`;
    const fecha = fechaEnDias(8);
    const creado = await prueba.agente
      .post(bloqueos)
      .set(con(propietario))
      .send({ inicio: horaLima(fecha, '10:00'), fin: horaLima(fecha, '11:00'), motivo: null })
      .expect(201);
    sin(creado.body, '/barberos/{id}/bloqueos', 'post', 201);
    sin(
      (await prueba.agente.get(bloqueos).set(con(propietario)).expect(200)).body,
      '/barberos/{id}/bloqueos',
      'get',
      200,
    );
    const malo = await prueba.agente
      .post(bloqueos)
      .set(con(propietario))
      .send({ inicio: horaLima(fecha, '11:00'), fin: horaLima(fecha, '10:00') })
      .expect(400);
    sin(malo.body, '/barberos/{id}/bloqueos', 'post', 400);
    await prueba.agente.delete(`${bloqueos}/${creado.body.id}`).set(con(propietario)).expect(204);
    const noHay = await prueba.agente
      .delete(`${bloqueos}/${creado.body.id}`)
      .set(con(propietario))
      .expect(404);
    sin(noHay.body, '/barberos/{id}/bloqueos/{bloqueoId}', 'delete', 404);
  });
});
