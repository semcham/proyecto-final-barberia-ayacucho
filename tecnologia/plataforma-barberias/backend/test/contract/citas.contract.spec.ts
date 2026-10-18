import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002 } from '../helpers/contrato';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../helpers/reservas';
import { sesionCliente } from '../helpers/sesiones';
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
});
