import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita, sembrarCliente } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T044 · Servicios (RF07; FR-006 a FR-008; R11, R12).

describe('Servicios', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let token: string;

  const como = () => ({ Authorization: `Bearer ${token}` });
  const crear = (cuerpo: object) => prueba.agente.post('/api/v1/servicios').set(como()).send(cuerpo);
  const editar = (id: string, cuerpo: object) =>
    prueba.agente.patch(`/api/v1/servicios/${id}`).set(como()).send(cuerpo);

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('crea un servicio activo con el precio normalizado', async () => {
    const { body } = await crear({ nombre: 'Corte y barba', precio: '35.5', duracionMinutos: 45 }).expect(
      201,
    );
    expect(body).toEqual({
      id: expect.any(String),
      nombre: 'Corte y barba',
      descripcion: null,
      precio: '35.50',
      duracionMinutos: 45,
      activo: true,
    });
  });

  it('un nombre repetido sin distinguir mayúsculas → 409 NOMBRE_DUPLICADO', async () => {
    await crear({ nombre: 'Tinte', precio: '50', duracionMinutos: 60 }).expect(201);
    const { body } = await crear({ nombre: '  TINTE ', precio: '40', duracionMinutos: 60 }).expect(409);
    expect(body.codigo).toBe('NOMBRE_DUPLICADO');
    // También al renombrar otro.
    const otro = await crear({ nombre: 'Peinado', precio: '20', duracionMinutos: 30 }).expect(201);
    expect((await editar(otro.body.id, { nombre: 'tinte' }).expect(409)).body.codigo).toBe(
      'NOMBRE_DUPLICADO',
    );
  });

  it.each([
    [{ nombre: 'Malo', precio: '-5', duracionMinutos: 30 }],
    [{ nombre: 'Malo', precio: '10', duracionMinutos: 0 }],
    [{ nombre: 'Malo', precio: '10', duracionMinutos: 33 }],
    [{ nombre: 'M', precio: '10', duracionMinutos: 30 }],
    [{ nombre: 'Malo', precio: '100000', duracionMinutos: 30 }],
  ])('datos inválidos %o → 400', async (cuerpo) => {
    await crear(cuerpo).expect(400);
  });

  it('GET /servicios lista activos e inactivos de la barbería', async () => {
    const creado = await crear({ nombre: 'Lavado', precio: '10', duracionMinutos: 15 }).expect(201);
    await editar(creado.body.id, { activo: false }).expect(200);
    const { body } = await prueba.agente.get('/api/v1/servicios').set(como()).expect(200);
    expect(body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: creado.body.id, activo: false }),
        expect.objectContaining({ id: e.servicioId, activo: true }),
      ]),
    );
  });

  it('editar el precio o la duración no cambia las citas ya reservadas', async () => {
    const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(4), '10:00')),
    });
    await editar(e.servicioId, { precio: '99', duracionMinutos: 60 }).expect(200);
    const { rows } = await poolDe('seed').query(
      'SELECT price, duration_min, service_name FROM appointment WHERE id = $1',
      [citaId],
    );
    expect(rows[0]).toEqual({ price: '20.00', duration_min: 30, service_name: 'Servicio sembrado' });
  });

  it('desactivar con citas futuras → 409 con la cantidad; con confirmación se desactiva, las citas siguen y se audita', async () => {
    const servicio = await crear({ nombre: 'Afeitado', precio: '15', duracionMinutos: 30 }).expect(201);
    const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
    const citas: string[] = [];
    for (const hora of ['11:00', '12:00']) {
      citas.push(
        await sembrarCita({
          tenantId: e.barberia.tenantId,
          barberoId: e.otroBarberoId,
          servicioId: servicio.body.id,
          clienteId: cliente.clienteId,
          inicio: new Date(horaLima(fechaEnDias(5), hora)),
        }),
      );
    }
    // Una cita pasada o cancelada no cuenta.
    await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.otroBarberoId,
      servicioId: servicio.body.id,
      clienteId: cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(5), '15:00')),
      estado: 'CANCELADA',
    });

    const conflicto = await editar(servicio.body.id, { activo: false }).expect(409);
    expect(conflicto.body.codigo).toBe('CONFLICTO_CON_CITAS');
    expect(conflicto.body.detalles.map((c: { id: string }) => c.id).sort()).toEqual([...citas].sort());
    const lista = await prueba.agente.get('/api/v1/servicios').set(como());
    expect(lista.body.find((s: { id: string }) => s.id === servicio.body.id).activo).toBe(true);

    const hecho = await editar(servicio.body.id, { activo: false, confirmarConflictos: true }).expect(200);
    expect(hecho.body.activo).toBe(false);
    const { rows } = await poolDe('seed').query(
      `SELECT count(*)::int AS n FROM appointment WHERE id = ANY($1) AND status = 'CONFIRMADA'`,
      [citas],
    );
    expect(rows[0].n).toBe(2);
    const auditoria = (await filasDe('audit_log', e.barberia.tenantId)).filter(
      (f) => f.action === 'SERVICIO_DESACTIVADO' && f.resource === `servicio:${servicio.body.id}`,
    );
    expect(auditoria).toHaveLength(1);
  });

  it('un servicio inexistente → 404 y no existe la operación de eliminar', async () => {
    await editar('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', { precio: '1' }).expect(404);
    const eliminar = await prueba.agente.delete(`/api/v1/servicios/${e.servicioId}`).set(como());
    expect(eliminar.status).toBe(404);
    const { rows } = await poolDe('seed').query('SELECT count(*)::int AS n FROM service WHERE id = $1', [
      e.servicioId,
    ]);
    expect(rows[0].n).toBe(1);
  });
});
