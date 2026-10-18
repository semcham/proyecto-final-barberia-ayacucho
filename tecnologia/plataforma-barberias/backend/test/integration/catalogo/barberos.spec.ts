import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  filasDe,
  sembrarBarberia,
  sembrarCita,
  sembrarCliente,
  sembrarSuscripcion,
  sembrarUsuario,
} from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T045 · Barberos (RF08; FR-009 a FR-012; R11, R13). El plan de prueba (TRIAL) permite 5 barberos activos.

const DIA_MS = 24 * 60 * 60 * 1000;
const MAX_TRIAL = 5;

describe('Barberos', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let token: string;

  const como = (t = token) => ({ Authorization: `Bearer ${t}` });
  const crear = (cuerpo: object, t = token) =>
    prueba.agente.post('/api/v1/barberos').set(como(t)).send(cuerpo);
  const editar = (id: string, cuerpo: object) =>
    prueba.agente.patch(`/api/v1/barberos/${id}`).set(como()).send(cuerpo);

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    token = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('crea un barbero con servicios; GET /barberos lo lista con sus servicios', async () => {
    const { body } = await crear({ nombre: 'Rosa', servicioIds: [e.servicioId] }).expect(201);
    expect(body).toEqual({
      id: expect.any(String),
      nombre: 'Rosa',
      activo: true,
      servicioIds: [e.servicioId],
      usuarioId: null,
    });
    const lista = await prueba.agente.get('/api/v1/barberos').set(como()).expect(200);
    expect(lista.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: body.id })]));
    // Deja espacio para las pruebas siguientes: se desactiva.
    await editar(body.id, { activo: false }).expect(200);
  });

  it('vincula a un usuario BARBERO activo o al propietario', async () => {
    const usuario = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const conBarbero = await crear({ nombre: 'Pedro', servicioIds: [], usuarioId: usuario.usuarioId }).expect(
      201,
    );
    expect(conBarbero.body.usuarioId).toBe(usuario.usuarioId);
    const conPropietario = await crear({
      nombre: 'El Dueño',
      servicioIds: [],
      usuarioId: e.barberia.propietarioId,
    }).expect(201);
    expect(conPropietario.body.usuarioId).toBe(e.barberia.propietarioId);

    // El mismo usuario en otro barbero → 409.
    const repetido = await crear({ nombre: 'Pedro 2', servicioIds: [], usuarioId: usuario.usuarioId }).expect(
      409,
    );
    expect(repetido.body.codigo).toBe('USUARIO_YA_VINCULADO');

    // Desactivar al usuario (operación de 001) no desactiva al barbero.
    await prueba.agente
      .patch(`/api/v1/usuarios/${usuario.usuarioId}`)
      .set(como())
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    const lista = await prueba.agente.get('/api/v1/barberos').set(como());
    expect(lista.body.find((b: { id: string }) => b.id === conBarbero.body.id).activo).toBe(true);

    for (const id of [conBarbero.body.id, conPropietario.body.id])
      await editar(id, { activo: false }).expect(200);
  });

  it('un usuario de otra barbería, un cliente o un barbero pendiente → 404', async () => {
    const otra = await barberiaParaReservar();
    const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
    const pendiente = await sembrarUsuario({
      tenantId: e.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'PENDIENTE',
      contrasena: null,
    });
    for (const usuarioId of [otra.barberia.propietarioId, cliente.usuarioId, pendiente.usuarioId]) {
      const { body } = await crear({ nombre: 'Intruso', servicioIds: [], usuarioId }).expect(404);
      expect(body.codigo).toBe('NO_ENCONTRADO');
    }
    // Servicios de otra barbería → 400.
    await crear({ nombre: 'Intruso', servicioIds: [otra.servicioId] }).expect(400);
  });

  it('desactivar con citas futuras sigue la confirmación en dos pasos y conserva las citas', async () => {
    const nuevo = await crear({ nombre: 'Julio', servicioIds: [e.servicioId] }).expect(201);
    const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: nuevo.body.id,
      servicioId: e.servicioId,
      clienteId: cliente.clienteId,
      inicio: new Date(horaLima(fechaEnDias(2), '10:00')),
    });
    const conflicto = await editar(nuevo.body.id, { activo: false }).expect(409);
    expect(conflicto.body.detalles).toEqual([
      expect.objectContaining({ id: citaId, barberoId: nuevo.body.id }),
    ]);
    await editar(nuevo.body.id, { activo: false, confirmarConflictos: true }).expect(200);
    const { rows } = await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [citaId]);
    expect(rows[0].status).toBe('CONFIRMADA');
    expect(
      (await filasDe('audit_log', e.barberia.tenantId)).filter((f) => f.action === 'BARBERO_DESACTIVADO'),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ resource: `barbero:${nuevo.body.id}` })]));
  });

  it(`el límite del plan (${MAX_TRIAL} activos) → 403 SUSCRIPCION_NO_PERMITE al crear y al reactivar`, async () => {
    const barberia = await sembrarBarberia();
    await sembrarSuscripcion({
      tenantId: barberia.tenantId,
      trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
    });
    const t = await tokenPara(barberia.tenantId, barberia.propietarioId, 'PROPIETARIO');
    const ids: string[] = [];
    for (let i = 0; i < MAX_TRIAL; i += 1) {
      ids.push((await crear({ nombre: `Barbero ${i}`, servicioIds: [] }, t).expect(201)).body.id);
    }
    const lleno = await crear({ nombre: 'Uno más', servicioIds: [] }, t).expect(403);
    expect(lleno.body.codigo).toBe('SUSCRIPCION_NO_PERMITE');

    await prueba.agente.patch(`/api/v1/barberos/${ids[0]}`).set(como(t)).send({ activo: false }).expect(200);
    const sexto = await crear({ nombre: 'Uno más', servicioIds: [] }, t).expect(201);
    const reactivar = await prueba.agente
      .patch(`/api/v1/barberos/${ids[0]}`)
      .set(como(t))
      .send({ activo: true })
      .expect(403);
    expect(reactivar.body.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect(sexto.body.activo).toBe(true);
  });

  it('con 10 creaciones simultáneas nunca se supera el límite del plan', async () => {
    const barberia = await sembrarBarberia();
    await sembrarSuscripcion({
      tenantId: barberia.tenantId,
      trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
    });
    const t = await tokenPara(barberia.tenantId, barberia.propietarioId, 'PROPIETARIO');
    const respuestas = await Promise.all(
      Array.from({ length: 10 }, (_, i) => crear({ nombre: `Simultáneo ${i}`, servicioIds: [] }, t)),
    );
    const estados = respuestas.map((r) => r.status).sort();
    expect(estados.filter((s) => s === 201)).toHaveLength(MAX_TRIAL);
    expect(estados.filter((s) => s === 403)).toHaveLength(10 - MAX_TRIAL);
    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS n FROM barber WHERE tenant_id = $1 AND active',
      [barberia.tenantId],
    );
    expect(rows[0].n).toBe(MAX_TRIAL);
  });

  it('el barbero puede ver la lista pero no crear ni editar', async () => {
    const usuario = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const t = await tokenPara(e.barberia.tenantId, usuario.usuarioId, 'BARBERO');
    await prueba.agente.get('/api/v1/barberos').set(como(t)).expect(200);
    await crear({ nombre: 'No', servicioIds: [] }, t).expect(403);
  });
});
