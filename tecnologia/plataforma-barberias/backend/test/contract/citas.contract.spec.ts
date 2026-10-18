import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002 } from '../helpers/contrato';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../helpers/reservas';
import { sembrarUsuario } from '../helpers/fixtures';
import { sesionCliente, tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T081 · Contrato (specs/002-catalogo-citas-cliente/contracts/openapi.yaml) de POST /citas.

describe('Contrato 002: POST /citas', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let token: string;
  const fecha = fechaEnDias(4);

  const reservar = (cuerpo: object, clave: string | null = nuevaClave(), conToken = token) => {
    const encabezados: Record<string, string> = { Authorization: `Bearer ${conToken}` };
    if (clave) encabezados['Idempotency-Key'] = clave;
    return prueba.agente.post('/api/v1/citas').set(encabezados).send(cuerpo);
  };

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    token = (await sesionCliente(e.barberia.tenantId)).token;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('201 y 200 (reintento) con el esquema Cita', async () => {
    const clave = nuevaClave();
    const cuerpo = { servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fecha, '10:00') };
    const creada = await reservar(cuerpo, clave).expect(201);
    expect(erroresDeContrato002('/citas', 'post', 201, creada.body)).toEqual([]);
    const repetida = await reservar(cuerpo, clave).expect(200);
    expect(erroresDeContrato002('/citas', 'post', 200, repetida.body)).toEqual([]);
  });

  it('409, 422 y 400 con el esquema Error', async () => {
    const cuerpo = { servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fecha, '11:00') };
    await reservar(cuerpo).expect(201);
    const otro = await sesionCliente(e.barberia.tenantId);
    const conflicto = await reservar(cuerpo, nuevaClave(), otro.token).expect(409);
    expect(erroresDeContrato002('/citas', 'post', 409, conflicto.body)).toEqual([]);

    const pasada = await reservar({ ...cuerpo, inicio: horaLima(fechaEnDias(-1), '11:00') }).expect(422);
    expect(erroresDeContrato002('/citas', 'post', 422, pasada.body)).toEqual([]);

    const sinClave = await reservar(cuerpo, null).expect(400);
    expect(erroresDeContrato002('/citas', 'post', 400, sinClave.body)).toEqual([]);
  });

  // T120 · GET /clientes/yo/citas (RF17).
  it('GET /clientes/yo/citas: 200 con PaginaCitas, 401 y 403', async () => {
    await reservar({
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(fecha, '15:00'),
    }).expect(201);
    const ok = await prueba.agente
      .get('/api/v1/clientes/yo/citas?pagina=1&tamano=10')
      .set({ Authorization: `Bearer ${token}` })
      .expect(200);
    expect(erroresDeContrato002('/clientes/yo/citas', 'get', 200, ok.body)).toEqual([]);
    expect(ok.body.elementos.length).toBeGreaterThan(0);

    const sinSesion = await prueba.agente.get('/api/v1/clientes/yo/citas').expect(401);
    expect(erroresDeContrato002('/clientes/yo/citas', 'get', 401, sinSesion.body)).toEqual([]);

    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const prohibido = await prueba.agente
      .get('/api/v1/clientes/yo/citas')
      .set({ Authorization: `Bearer ${propietario}` })
      .expect(403);
    expect(erroresDeContrato002('/clientes/yo/citas', 'get', 403, prohibido.body)).toEqual([]);
  });

  // T114 · POST /citas/{id}/cancelar (RF14).
  it('POST /citas/{id}/cancelar: 200 con Cita (y cancelacionTardiaDesde), 401, 403, 404 y 422', async () => {
    const ruta = (id: string) => `/api/v1/citas/${id}/cancelar`;
    const cuerpo = { servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(fecha, '12:00') };
    const reserva = await reservar(cuerpo).expect(201);
    expect(reserva.body.cancelacionTardiaDesde).toBe(horaLima(fecha, '10:00'));

    const ok = await prueba.agente
      .post(ruta(reserva.body.id))
      .set({ Authorization: `Bearer ${token}` })
      .send({ motivo: 'No podré ir' })
      .expect(200);
    expect(erroresDeContrato002('/citas/{id}/cancelar', 'post', 200, ok.body)).toEqual([]);
    expect(ok.body).toMatchObject({ estado: 'CANCELADA', cancelacionTardia: false });

    const otraVez = await prueba.agente
      .post(ruta(reserva.body.id))
      .set({ Authorization: `Bearer ${token}` })
      .expect(422);
    expect(erroresDeContrato002('/citas/{id}/cancelar', 'post', 422, otraVez.body)).toEqual([]);

    const noHay = await prueba.agente
      .post(ruta('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'))
      .set({ Authorization: `Bearer ${token}` })
      .expect(404);
    expect(erroresDeContrato002('/citas/{id}/cancelar', 'post', 404, noHay.body)).toEqual([]);

    const sinSesion = await prueba.agente.post(ruta(reserva.body.id)).expect(401);
    expect(erroresDeContrato002('/citas/{id}/cancelar', 'post', 401, sinSesion.body)).toEqual([]);

    const barbero = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const tokenBarbero = await tokenPara(e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    const prohibido = await prueba.agente
      .post(ruta(reserva.body.id))
      .set({ Authorization: `Bearer ${tokenBarbero}` })
      .expect(403);
    expect(erroresDeContrato002('/citas/{id}/cancelar', 'post', 403, prohibido.body)).toEqual([]);
  });
});
