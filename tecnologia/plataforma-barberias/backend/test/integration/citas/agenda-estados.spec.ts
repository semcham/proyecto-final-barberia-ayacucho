import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  filasDe,
  sembrarBloqueo,
  sembrarCita,
  sembrarCliente,
  sembrarDisponibilidad,
  sembrarUsuario,
} from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
  SEMANA_COMPLETA,
} from '../../helpers/reservas';
import { sesionBarberoVinculado, sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T099 · Agenda (RF16) y estados de la cita (RF15): marcas calculadas al leer, alcance del barbero,
// historial, auditoría y cambios simultáneos.

interface CitaAgenda {
  id: string;
  barberoId: string;
  barbero: string;
  inicio: string;
  estado: string;
  origen: string;
  enConflicto: boolean;
  cancelacionTardia: boolean;
  cliente: { nombre: string; telefono: string };
}

describe('Agenda y estados de las citas', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let tokenPropietario: string;
  let vinculado: { usuarioId: string; barberoId: string; token: string };
  const fecha = fechaEnDias(2);
  const ayer = fechaEnDias(-1);

  const como = (t: string) => ({ Authorization: `Bearer ${t}` });
  const agenda = (consulta: string, t = tokenPropietario) =>
    prueba.agente.get(`/api/v1/agenda?${consulta}`).set(como(t));
  const cambiarEstado = (id: string, estado: string, t = tokenPropietario) =>
    prueba.agente.post(`/api/v1/citas/${id}/estado`).set(como(t)).send({ estado });
  const citaDe = async (opciones: { barberoId: string; inicio: string; clienteId?: string }) =>
    sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: opciones.barberoId,
      servicioId: e.servicioId,
      clienteId: opciones.clienteId ?? (await sembrarCliente({ tenantId: e.barberia.tenantId })).clienteId,
      inicio: new Date(opciones.inicio),
    });

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    tokenPropietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    vinculado = await sesionBarberoVinculado(e.barberia.tenantId, [e.servicioId]);
    await sembrarDisponibilidad(e.barberia.tenantId, vinculado.barberoId, SEMANA_COMPLETA);
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('agenda del propietario', () => {
    it('ve las citas del día local ordenadas, con nombre y teléfono del cliente (también presencial), filtrables por barbero', async () => {
      const dia = fechaEnDias(3);
      const conCuenta = await sembrarCliente({
        tenantId: e.barberia.tenantId,
        nombre: 'Ana Cliente',
        telefono: '911111111',
      });
      const presencial = await sembrarCliente({
        tenantId: e.barberia.tenantId,
        conCuenta: false,
        nombre: 'Pedro Presencial',
        telefono: '922222222',
      });
      const tarde = await citaDe({
        barberoId: e.barberoId,
        inicio: horaLima(dia, '11:00'),
        clienteId: conCuenta.clienteId,
      });
      const temprano = await citaDe({
        barberoId: e.otroBarberoId,
        inicio: horaLima(dia, '09:30'),
        clienteId: presencial.clienteId,
      });
      // Otro día: no aparece. 23:30 del día anterior en Lima es el mismo día en UTC.
      await citaDe({ barberoId: e.barberoId, inicio: horaLima(fechaEnDias(2), '23:30') });

      const { body } = await agenda(`fecha=${dia}`).expect(200);
      expect(body).toMatchObject({ fecha: dia, zonaHoraria: 'America/Lima' });
      const citas: CitaAgenda[] = body.citas;
      expect(citas.map((c) => c.id)).toEqual([temprano, tarde]);
      expect(citas[0]).toMatchObject({
        barberoId: e.otroBarberoId,
        barbero: 'Ana',
        inicio: horaLima(dia, '09:30'),
        estado: 'CONFIRMADA',
        enConflicto: false,
        cancelacionTardia: false,
        cliente: { nombre: 'Pedro Presencial', telefono: '922222222' },
      });
      expect(citas[1].cliente).toEqual({ nombre: 'Ana Cliente', telefono: '911111111' });

      const filtrada = await agenda(`fecha=${dia}&barbero=${e.barberoId}`).expect(200);
      expect(filtrada.body.citas.map((c: CitaAgenda) => c.id)).toEqual([tarde]);
    });

    it('fecha mal formada → 400', async () => {
      await agenda('fecha=2026-02-30').expect(400);
      await agenda('fecha=hoy').expect(400);
    });
  });

  describe('agenda del barbero', () => {
    it('el barbero vinculado ve solo las suyas; con otro barbero → 403; sin vínculo → 403', async () => {
      const dia = fechaEnDias(4);
      const suya = await citaDe({ barberoId: vinculado.barberoId, inicio: horaLima(dia, '10:00') });
      await citaDe({ barberoId: e.barberoId, inicio: horaLima(dia, '10:00') });

      const propia = await agenda(`fecha=${dia}`, vinculado.token).expect(200);
      expect(propia.body.citas.map((c: CitaAgenda) => c.id)).toEqual([suya]);
      await agenda(`fecha=${dia}&barbero=${vinculado.barberoId}`, vinculado.token).expect(200);
      await agenda(`fecha=${dia}&barbero=${e.barberoId}`, vinculado.token).expect(403);

      const sinVinculo = await sembrarUsuario({
        tenantId: e.barberia.tenantId,
        rol: 'BARBERO',
        estado: 'ACTIVA',
      });
      const tokenSinVinculo = await tokenPara(e.barberia.tenantId, sinVinculo.usuarioId, 'BARBERO');
      await agenda(`fecha=${dia}`, tokenSinVinculo).expect(403);
    });

    it('un cliente no ve la agenda', async () => {
      const { token } = await sesionCliente(e.barberia.tenantId);
      await agenda(`fecha=${fecha}`, token).expect(403);
    });
  });

  describe('cambio de estado', () => {
    it('queda en el historial con su autor y se audita CITA_ESTADO_CAMBIADO', async () => {
      const id = await citaDe({ barberoId: e.barberoId, inicio: horaLima(ayer, '10:00') });
      const { body } = await cambiarEstado(id, 'COMPLETADA').expect(200);
      expect(body).toMatchObject({
        id,
        estado: 'COMPLETADA',
        barbero: 'Luis',
        servicio: 'Servicio sembrado',
      });

      const historial = await poolDe('seed').query(
        'SELECT from_status, to_status, changed_by FROM appointment_status_history WHERE appointment_id = $1',
        [id],
      );
      expect(historial.rows).toEqual([
        { from_status: 'CONFIRMADA', to_status: 'COMPLETADA', changed_by: e.barberia.propietarioId },
      ]);
      const auditoria = (await filasDe('audit_log', e.barberia.tenantId)).filter(
        (f) => f.action === 'CITA_ESTADO_CAMBIADO' && f.resource === `cita:${id}`,
      );
      expect(auditoria).toHaveLength(1);
    });

    it('el barbero marca sus citas; la de otro barbero → 404', async () => {
      const suya = await citaDe({ barberoId: vinculado.barberoId, inicio: horaLima(ayer, '11:00') });
      const ajena = await citaDe({ barberoId: e.barberoId, inicio: horaLima(ayer, '11:00') });
      expect((await cambiarEstado(suya, 'NO_ASISTIO', vinculado.token).expect(200)).body.estado).toBe(
        'NO_ASISTIO',
      );
      expect((await cambiarEstado(ajena, 'NO_ASISTIO', vinculado.token).expect(404)).body.codigo).toBe(
        'NO_ENCONTRADO',
      );
    });

    it('dos cambios simultáneos se serializan: uno gana y el otro recibe TRANSICION_INVALIDA', async () => {
      const id = await citaDe({ barberoId: e.otroBarberoId, inicio: horaLima(ayer, '12:00') });
      const respuestas = await Promise.all([
        cambiarEstado(id, 'COMPLETADA'),
        cambiarEstado(id, 'NO_ASISTIO'),
      ]);
      expect(respuestas.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(respuestas.find((r) => r.status === 422)?.body.codigo).toBe('TRANSICION_INVALIDA');
      const historial = await poolDe('seed').query(
        'SELECT count(*)::int AS n FROM appointment_status_history WHERE appointment_id = $1',
        [id],
      );
      expect(historial.rows[0].n).toBe(1);
    });

    it('una cita futura no puede marcarse como completada; un estado fuera del contrato → 400', async () => {
      const id = await citaDe({ barberoId: e.barberoId, inicio: horaLima(fecha, '17:00') });
      const { body } = await cambiarEstado(id, 'COMPLETADA').expect(422);
      expect(body).toMatchObject({
        codigo: 'TRANSICION_INVALIDA',
        detalles: [{ desde: 'CONFIRMADA', hacia: 'COMPLETADA' }],
      });
      await cambiarEstado(id, 'CANCELADA').expect(400);
      await cambiarEstado('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'COMPLETADA').expect(404);
    });
  });

  describe('marcas de conflicto', () => {
    it('una cita en conflicto deja de estarlo al borrar el bloqueo', async () => {
      const dia = fechaEnDias(5);
      const id = await citaDe({ barberoId: e.barberoId, inicio: horaLima(dia, '15:00') });
      const bloqueoId = await sembrarBloqueo({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        inicio: new Date(horaLima(dia, '14:00')),
        fin: new Date(horaLima(dia, '16:00')),
      });
      const conBloqueo = await agenda(`fecha=${dia}`).expect(200);
      expect(conBloqueo.body.citas.find((c: CitaAgenda) => c.id === id).enConflicto).toBe(true);

      await prueba.agente
        .delete(`/api/v1/barberos/${e.barberoId}/bloqueos/${bloqueoId}`)
        .set(como(tokenPropietario))
        .expect(204);
      const sinBloqueo = await agenda(`fecha=${dia}`).expect(200);
      expect(sinBloqueo.body.citas.find((c: CitaAgenda) => c.id === id).enConflicto).toBe(false);
    });

    it('una cita fuera de la disponibilidad reducida aparece en conflicto', async () => {
      const dia = fechaEnDias(6);
      const id = await citaDe({ barberoId: e.otroBarberoId, inicio: horaLima(dia, '18:00') });
      await prueba.agente
        .put(`/api/v1/barberos/${e.otroBarberoId}/disponibilidad`)
        .set(como(tokenPropietario))
        .send({
          tramos: [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio: '09:00', fin: '13:00' })),
          confirmarConflictos: true,
        })
        .expect(200);
      const { body } = await agenda(`fecha=${dia}&barbero=${e.otroBarberoId}`).expect(200);
      expect(body.citas.find((c: CitaAgenda) => c.id === id).enConflicto).toBe(true);
    });

    it('carrera entre reserva y bloqueo: la cita que entró antes de confirmar el bloqueo sigue activa y en conflicto', async () => {
      const dia = fechaEnDias(7);
      const cliente = await sesionCliente(e.barberia.tenantId);
      // El propietario revisa el bloqueo de 16:00 a 17:00: aún no hay citas. Mientras decide, entra una reserva.
      const reserva = await prueba.agente
        .post('/api/v1/citas')
        .set({ ...como(cliente.token), 'Idempotency-Key': nuevaClave() })
        .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(dia, '16:00') })
        .expect(201);
      // Confirma el bloqueo que había visto sin conflictos: se crea y la cita no se pierde ni se cancela.
      await prueba.agente
        .post(`/api/v1/barberos/${e.barberoId}/bloqueos`)
        .set(como(tokenPropietario))
        .send({ inicio: horaLima(dia, '16:00'), fin: horaLima(dia, '17:00'), confirmarConflictos: true })
        .expect(201);
      const { body } = await agenda(`fecha=${dia}`).expect(200);
      expect(body.citas.find((c: CitaAgenda) => c.id === reserva.body.id)).toMatchObject({
        estado: 'CONFIRMADA',
        enConflicto: true,
      });
    });
  });
});
