import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita, sembrarCliente } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionBarberoVinculado, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T046 · Disponibilidad semanal y bloqueos (RF09; FR-013 a FR-016; R11).

const todosLosDias = (inicio: string, fin: string) =>
  [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio, fin }));

describe('Disponibilidad y bloqueos', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let tokenPropietario: string;
  let vinculado: { usuarioId: string; barberoId: string; token: string };

  const como = (t: string) => ({ Authorization: `Bearer ${t}` });
  const disponibilidad = (barberoId: string, cuerpo: object, t = tokenPropietario) =>
    prueba.agente.put(`/api/v1/barberos/${barberoId}/disponibilidad`).set(como(t)).send(cuerpo);
  const bloquear = (barberoId: string, cuerpo: object, t = tokenPropietario) =>
    prueba.agente.post(`/api/v1/barberos/${barberoId}/bloqueos`).set(como(t)).send(cuerpo);
  const auditadas = async (accion: string) =>
    (await filasDe('audit_log', e.barberia.tenantId)).filter((f) => f.action === accion);

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    tokenPropietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    vinculado = await sesionBarberoVinculado(e.barberia.tenantId, [e.servicioId]);
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('disponibilidad semanal', () => {
    it('un tramo fuera del horario de atención → 422 FUERA_DEL_HORARIO_DE_ATENCION', async () => {
      const { body } = await disponibilidad(e.barberoId, {
        tramos: [{ diaSemana: 2, inicio: '08:00', fin: '12:00' }],
      }).expect(422);
      expect(body.codigo).toBe('FUERA_DEL_HORARIO_DE_ATENCION');
      expect(body.detalles).toEqual([{ diaSemana: 2 }]);
    });

    it('el barbero vinculado ve y edita la suya; la de otro barbero → 403', async () => {
      const propia = { tramos: [{ diaSemana: 1, inicio: '10:00', fin: '14:00' }] };
      const { body } = await disponibilidad(vinculado.barberoId, propia, vinculado.token).expect(200);
      expect(body.tramos).toEqual(propia.tramos);
      await prueba.agente
        .get(`/api/v1/barberos/${vinculado.barberoId}/disponibilidad`)
        .set(como(vinculado.token))
        .expect(200);

      await disponibilidad(e.barberoId, propia, vinculado.token).expect(403);
      await prueba.agente
        .get(`/api/v1/barberos/${e.barberoId}/disponibilidad`)
        .set(como(vinculado.token))
        .expect(403);
    });

    it('el propietario edita la de cualquier barbero; datos inválidos → 400', async () => {
      await disponibilidad(vinculado.barberoId, { tramos: todosLosDias('09:00', '19:00') }).expect(200);
      await disponibilidad(e.otroBarberoId, {
        tramos: [{ diaSemana: 1, inicio: '12:00', fin: '10:00' }],
      }).expect(400);
      await prueba.agente
        .put('/api/v1/barberos/0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b/disponibilidad')
        .set(como(tokenPropietario))
        .send({ tramos: [] })
        .expect(404);
    });

    it('reducirla con citas activas fuera → 409; con confirmación guarda y la cita sigue', async () => {
      const fecha = fechaEnDias(3);
      const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId });
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.otroBarberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(horaLima(fecha, '17:00')),
      });
      const reducida = { tramos: todosLosDias('09:00', '12:00') };
      const conflicto = await disponibilidad(e.otroBarberoId, reducida).expect(409);
      expect(conflicto.body.detalles).toEqual([expect.objectContaining({ id: citaId })]);
      await disponibilidad(e.otroBarberoId, { ...reducida, confirmarConflictos: true }).expect(200);
      const { rows } = await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [citaId]);
      expect(rows[0].status).toBe('CONFIRMADA');
      expect(await auditadas('CAMBIO_CON_CONFLICTO')).toHaveLength(1);
    });
  });

  describe('bloqueos', () => {
    const fecha = fechaEnDias(6);

    it('un bloqueo sin citas se crea y aparece en la lista; eliminarlo funciona', async () => {
      const creado = await bloquear(e.barberoId, {
        inicio: horaLima(fecha, '09:00'),
        fin: horaLima(fecha, '10:00'),
        motivo: 'Trámite',
      }).expect(201);
      expect(creado.body).toEqual({
        id: expect.any(String),
        barberoId: e.barberoId,
        inicio: horaLima(fecha, '09:00'),
        fin: horaLima(fecha, '10:00'),
        motivo: 'Trámite',
      });
      const lista = await prueba.agente
        .get(`/api/v1/barberos/${e.barberoId}/bloqueos`)
        .set(como(tokenPropietario))
        .expect(200);
      expect(lista.body).toEqual([creado.body]);

      const ruta = `/api/v1/barberos/${e.barberoId}/bloqueos/${creado.body.id}`;
      await prueba.agente.delete(ruta).set(como(tokenPropietario)).expect(204);
      await prueba.agente.delete(ruta).set(como(tokenPropietario)).expect(404);
    });

    it('un bloqueo con citas activas → 409 con la lista sin datos del cliente; con confirmación se crea y las citas no cambian', async () => {
      const cliente = await sembrarCliente({ tenantId: e.barberia.tenantId, nombre: 'Cliente Secreto' });
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(horaLima(fecha, '15:00')),
      });
      const cuerpo = { inicio: horaLima(fecha, '14:00'), fin: horaLima(fecha, '16:00') };
      const conflicto = await bloquear(e.barberoId, cuerpo).expect(409);
      expect(conflicto.body.codigo).toBe('CONFLICTO_CON_CITAS');
      expect(conflicto.body.detalles).toEqual([
        {
          id: citaId,
          inicio: horaLima(fecha, '15:00'),
          barberoId: e.barberoId,
          servicio: 'Servicio sembrado',
        },
      ]);
      expect(JSON.stringify(conflicto.body)).not.toContain('Cliente Secreto');
      expect(JSON.stringify(conflicto.body)).not.toContain(cliente.telefono);
      expect(await filasDe('time_off', e.barberia.tenantId)).toHaveLength(0);

      await bloquear(e.barberoId, { ...cuerpo, confirmarConflictos: true }).expect(201);
      const { rows } = await poolDe('seed').query('SELECT status FROM appointment WHERE id = $1', [citaId]);
      expect(rows[0].status).toBe('CONFIRMADA');
      expect(await auditadas('BLOQUEO_CON_CONFLICTO')).toHaveLength(1);
    });

    it('inicio ≥ fin o más de 30 días → 400', async () => {
      await bloquear(e.barberoId, { inicio: horaLima(fecha, '12:00'), fin: horaLima(fecha, '11:00') }).expect(
        400,
      );
      await bloquear(e.barberoId, {
        inicio: horaLima(fecha, '12:00'),
        fin: horaLima(fechaEnDias(40), '12:00'),
      }).expect(400);
    });

    it('el barbero vinculado opera solo sus bloqueos', async () => {
      const propio = await bloquear(
        vinculado.barberoId,
        { inicio: horaLima(fecha, '09:00'), fin: horaLima(fecha, '09:30') },
        vinculado.token,
      ).expect(201);
      await bloquear(
        e.barberoId,
        { inicio: horaLima(fecha, '09:00'), fin: horaLima(fecha, '09:30') },
        vinculado.token,
      ).expect(403);
      await prueba.agente
        .get(`/api/v1/barberos/${e.barberoId}/bloqueos`)
        .set(como(vinculado.token))
        .expect(403);
      await prueba.agente
        .delete(`/api/v1/barberos/${vinculado.barberoId}/bloqueos/${propio.body.id}`)
        .set(como(vinculado.token))
        .expect(204);
    });
  });
});
