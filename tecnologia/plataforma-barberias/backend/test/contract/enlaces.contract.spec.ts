import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato004 } from '../helpers/contrato';
import { citaConEnlaces, ipUnica, solicitudDeEnlace } from '../helpers/enlaces';
import { sembrarCita } from '../helpers/fixtures';
import { type BarberiaParaReservar, barberiaParaReservar, fechaEnDias, horaLima } from '../helpers/reservas';
import { sesionCliente } from '../helpers/sesiones';
import { cerrarPools, poolDe } from '../helpers/test-db';

// T085 · Contrato (specs/004-notificaciones-reprogramacion/contracts/openapi.yaml) de las rutas de enlaces:
// GET /enlaces/accion (EnlaceAccion) y POST /enlaces/accion/{confirmar,cancelar,reprogramar} (ResultadoAccion),
// con 410 ENLACE_NO_VALIDO, 429 DEMASIADOS_INTENTOS y, en reprogramar, 403, 409 y 422.

describe('Contrato 004: /enlaces/accion*', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET: 200 EnlaceAccion (con reprogramacion para REPROGRAMAR) y 410', async () => {
    const c = await citaConEnlaces(prueba, e, 300);
    for (const accion of ['CONFIRMAR', 'CANCELAR', 'REPROGRAMAR'] as const) {
      const { body } = await solicitudDeEnlace(prueba, 'consultar', c.enlace(accion), ipUnica()).expect(200);
      expect(erroresDeContrato004('/enlaces/accion', 'get', 200, body)).toEqual([]);
    }
    const { body } = await solicitudDeEnlace(prueba, 'consultar', 'no.vale', ipUnica()).expect(410);
    expect(erroresDeContrato004('/enlaces/accion', 'get', 410, body)).toEqual([]);
  });

  it('POST confirmar y cancelar: 200 ResultadoAccion; 410', async () => {
    const c = await citaConEnlaces(prueba, e, 330);
    const ip = ipUnica();
    const confirmada = await solicitudDeEnlace(prueba, 'confirmar', c.enlace('CONFIRMAR'), ip).expect(200);
    expect(erroresDeContrato004('/enlaces/accion/confirmar', 'post', 200, confirmada.body)).toEqual([]);
    const cancelada = await solicitudDeEnlace(prueba, 'cancelar', c.enlace('CANCELAR'), ip).expect(200);
    expect(erroresDeContrato004('/enlaces/accion/cancelar', 'post', 200, cancelada.body)).toEqual([]);
    const otraVez = await solicitudDeEnlace(prueba, 'cancelar', c.enlace('CANCELAR'), ip).expect(410);
    expect(erroresDeContrato004('/enlaces/accion/cancelar', 'post', 410, otraVez.body)).toEqual([]);
    const usado = await solicitudDeEnlace(prueba, 'confirmar', 'no.vale', ip).expect(410);
    expect(erroresDeContrato004('/enlaces/accion/confirmar', 'post', 410, usado.body)).toEqual([]);
  });

  it('POST reprogramar: 200, 409, 422 y 403', async () => {
    const ip = ipUnica();
    const c = await citaConEnlaces(prueba, e, 360);
    const ruta = '/enlaces/accion/reprogramar';
    const ocupada = horaLima(fechaEnDias(4), '10:00');
    const otro = await sesionCliente(e.barberia.tenantId);
    await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: otro.cliente.clienteId,
      inicio: new Date(ocupada),
    });
    const token = c.enlace('REPROGRAMAR');
    const conflicto = await solicitudDeEnlace(prueba, 'reprogramar', token, ip, { inicio: ocupada }).expect(
      409,
    );
    expect(erroresDeContrato004(ruta, 'post', 409, conflicto.body)).toEqual([]);
    const pasada = await solicitudDeEnlace(prueba, 'reprogramar', token, ip, {
      inicio: horaLima(fechaEnDias(-1), '10:00'),
    }).expect(422);
    expect(erroresDeContrato004(ruta, 'post', 422, pasada.body)).toEqual([]);
    const hecha = await solicitudDeEnlace(prueba, 'reprogramar', token, ip, {
      inicio: horaLima(fechaEnDias(4), '10:30'),
    }).expect(200);
    expect(erroresDeContrato004(ruta, 'post', 200, hecha.body)).toEqual([]);

    const g = await barberiaParaReservar();
    const d = await citaConEnlaces(prueba, g, 300);
    await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE tenant_id = $1`, [
      g.barberia.tenantId,
    ]);
    const vencida = await solicitudDeEnlace(prueba, 'reprogramar', d.enlace('REPROGRAMAR'), ip, {
      inicio: horaLima(fechaEnDias(4), '11:00'),
    }).expect(403);
    expect(erroresDeContrato004(ruta, 'post', 403, vencida.body)).toEqual([]);
  });

  it('429 DEMASIADOS_INTENTOS con reintentarEnSegundos', async () => {
    const ip = ipUnica();
    for (let i = 0; i < 5; i += 1) await solicitudDeEnlace(prueba, 'consultar', `x.${i}`, ip).expect(410);
    const bloqueada = await solicitudDeEnlace(prueba, 'consultar', 'x.y', ip).expect(429);
    expect(erroresDeContrato004('/enlaces/accion', 'get', 429, bloqueada.body)).toEqual([]);
    expect(bloqueada.body.detalles[0].reintentarEnSegundos).toBeGreaterThan(0);
    const enPost = await solicitudDeEnlace(prueba, 'cancelar', 'x.y', ip).expect(429);
    expect(erroresDeContrato004('/enlaces/accion/cancelar', 'post', 429, enPost.body)).toEqual([]);
  });
});
