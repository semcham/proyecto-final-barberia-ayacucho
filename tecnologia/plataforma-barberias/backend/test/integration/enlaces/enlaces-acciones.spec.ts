import { type AppDePrueba, crearApp } from '../../helpers/app';
import { citaConEnlaces, filaDeCita, ipUnica, solicitudDeEnlace, usosDeEnlace } from '../../helpers/enlaces';
import { avisosDe } from '../../helpers/avisos';
import { sembrarCita } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  citasActivasEn,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T079 · Acciones por enlace sin sesión (US3-2 a US3-4, US3-8; FR-026, FR-028 a FR-030; PR28;
// contracts/enlaces-de-accion.md §3–§5). GET muestra los datos mínimos y NO consume el enlace; confirmar marca la
// asistencia; cancelar libera la hora con las reglas del cliente (tardía incluida) y avisa al personal; reprogramar
// aplica las reglas del cliente y, si falla, el enlace sigue sin usar. Con la barbería suspendida o una suscripción
// que no acepta reservas, confirmar y cancelar siguen y reprogramar responde 403 sin consumir el enlace.

describe('Acciones por enlace (T079, US3)', () => {
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

  it('GET muestra solo los datos mínimos y no consume el enlace (US3-8)', async () => {
    const c = await citaConEnlaces(prueba, e, 300);
    const token = c.enlace('CONFIRMAR');
    const ip = ipUnica();
    const primera = await solicitudDeEnlace(prueba, 'consultar', token, ip).expect(200);
    await solicitudDeEnlace(prueba, 'consultar', token, ip).expect(200);
    expect(primera.body).toEqual({
      accion: 'CONFIRMAR',
      cita: {
        barberia: expect.any(String),
        servicio: 'Servicio sembrado',
        barbero: 'Luis',
        inicio: expect.stringMatching(/-05:00$/),
        fin: expect.stringMatching(/-05:00$/),
        zonaHoraria: 'America/Lima',
      },
    });
    const texto = JSON.stringify(primera.body);
    expect(texto).not.toContain(c.cliente.cliente.telefono);
    expect(texto).not.toContain('@');
    expect(await usosDeEnlace(c.citaId)).toEqual([]);
    // Sigue sirviendo después de abrirlo.
    await solicitudDeEnlace(prueba, 'confirmar', token, ip).expect(200);
  });

  it('confirmar marca client_confirmed_at sin cambiar la versión; después se puede cancelar con el otro enlace', async () => {
    const c = await citaConEnlaces(prueba, e, 360);
    const ip = ipUnica();
    const { body } = await solicitudDeEnlace(prueba, 'confirmar', c.enlace('CONFIRMAR'), ip).expect(200);
    expect(body).toMatchObject({
      accion: 'CONFIRMAR',
      cita: { estado: 'CONFIRMADA', confirmadaPorClienteEn: expect.stringMatching(/-05:00$/) },
    });
    const fila = await filaDeCita(c.citaId);
    expect(fila.client_confirmed_at).not.toBeNull();
    expect(fila.version).toBe(1);
    expect(await usosDeEnlace(c.citaId)).toEqual([expect.objectContaining({ action: 'CONFIRMAR' })]);

    // US3: confirmar y luego cancelar está permitido (confirmar no cambia la versión).
    await solicitudDeEnlace(prueba, 'cancelar', c.enlace('CANCELAR'), ip).expect(200);
    expect((await filaDeCita(c.citaId)).status).toBe('CANCELADA');
  });

  it('GET de cancelar muestra desde cuándo sería tardía; cancelar tarde libera la hora, marca tardía y avisa al personal', async () => {
    const c = await citaConEnlaces(prueba, e, 60, e.otroBarberoId);
    const ip = ipUnica();
    const consulta = await solicitudDeEnlace(prueba, 'consultar', c.enlace('CANCELAR'), ip).expect(200);
    expect(consulta.body.cita.cancelacionTardiaDesde).toMatch(/-05:00$/);

    const { body } = await solicitudDeEnlace(prueba, 'cancelar', c.enlace('CANCELAR'), ip).expect(200);
    expect(body).toMatchObject({
      accion: 'CANCELAR',
      cita: { estado: 'CANCELADA', cancelacionTardia: true },
    });
    const fila = await filaDeCita(c.citaId);
    expect(fila).toMatchObject({
      status: 'CANCELADA',
      late_cancellation: true,
      cancelled_by: null,
      version: 2,
    });
    const fin = new Date(c.inicio.getTime() + 30 * 60_000);
    expect(await citasActivasEn(e.otroBarberoId, c.inicio.toISOString(), fin.toISOString())).toBe(0);

    // Historial: el cambio de estado por enlace no tiene usuario (migración 0027).
    const { rows } = await poolDe('seed').query(
      'SELECT from_status, to_status, changed_by FROM appointment_status_history WHERE appointment_id = $1',
      [c.citaId],
    );
    expect(rows).toEqual([{ from_status: 'CONFIRMADA', to_status: 'CANCELADA', changed_by: null }]);
    // Avisos de US2: el cliente canceló → cliente y propietario.
    const avisos = (await avisosDe(e.barberia.tenantId)).filter(
      (a) => a.kind === 'CITA_CANCELADA' && a.appointment_id === c.citaId,
    );
    expect(avisos.map((a) => a.recipient_kind).sort()).toEqual(['CLIENTE', 'PROPIETARIO']);
  });

  it('reprogramar: GET da lo que necesita la pantalla pública; aplica las reglas del cliente y deja la vía ENLACE', async () => {
    const c = await citaConEnlaces(prueba, e, 480);
    const ip = ipUnica();
    const token = c.enlace('REPROGRAMAR');
    const consulta = await solicitudDeEnlace(prueba, 'consultar', token, ip).expect(200);
    expect(consulta.body).toMatchObject({
      accion: 'REPROGRAMAR',
      reprogramacion: { slug: e.barberia.slug, servicioId: e.servicioId, barberoId: e.barberoId },
    });

    const destino = horaLima(fechaEnDias(4), '10:00');
    const { body } = await solicitudDeEnlace(prueba, 'reprogramar', token, ip, { inicio: destino }).expect(
      200,
    );
    expect(body).toMatchObject({ accion: 'REPROGRAMAR', cita: { estado: 'CONFIRMADA', inicio: destino } });
    expect((await filaDeCita(c.citaId)).version).toBe(2);
    const { rows } = await poolDe('seed').query(
      'SELECT via, changed_by FROM appointment_reschedule WHERE appointment_id = $1',
      [c.citaId],
    );
    expect(rows).toEqual([{ via: 'ENLACE', changed_by: null }]);
    expect(await usosDeEnlace(c.citaId)).toEqual([expect.objectContaining({ action: 'REPROGRAMAR' })]);
  });

  it('una reprogramación que falla (409, 422 sin antelación) no consume el enlace', async () => {
    const ip = ipUnica();
    const ocupada = await citaConEnlaces(prueba, e, 420);
    const otro = await sesionCliente(e.barberia.tenantId);
    const hora = horaLima(fechaEnDias(4), '11:00');
    await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: otro.cliente.clienteId,
      inicio: new Date(hora),
    });
    const token = ocupada.enlace('REPROGRAMAR');
    const conflicto = await solicitudDeEnlace(prueba, 'reprogramar', token, ip, { inicio: hora }).expect(409);
    expect(conflicto.body.codigo).toBe('HORARIO_NO_DISPONIBLE');
    expect(await usosDeEnlace(ocupada.citaId)).toEqual([]);
    // El mismo enlace sirve para otra hora.
    await solicitudDeEnlace(prueba, 'reprogramar', token, ip, {
      inicio: horaLima(fechaEnDias(4), '11:30'),
    }).expect(200);

    const sinAntelacion = await citaConEnlaces(prueba, e, 50, e.otroBarberoId);
    const respuesta = await solicitudDeEnlace(
      prueba,
      'reprogramar',
      sinAntelacion.enlace('REPROGRAMAR'),
      ip,
      {
        inicio: horaLima(fechaEnDias(4), '12:00'),
      },
    ).expect(422);
    expect(respuesta.body).toMatchObject({
      codigo: 'SIN_ANTELACION_PARA_REPROGRAMAR',
      detalles: [{ puedeCancelar: true }],
    });
    expect(await usosDeEnlace(sinAntelacion.citaId)).toEqual([]);
  });

  it('con la barbería suspendida: confirmar y cancelar siguen; reprogramar → 403 sin consumir el enlace', async () => {
    const g = await barberiaParaReservar();
    const ip = ipUnica();
    const aConfirmar = await citaConEnlaces(prueba, g, 300);
    const aCancelar = await citaConEnlaces(prueba, g, 330);
    const aReprogramar = await citaConEnlaces(prueba, g, 360);
    await poolDe('seed').query(`UPDATE tenant SET status = 'SUSPENDIDA' WHERE id = $1`, [
      g.barberia.tenantId,
    ]);
    await poolDe('seed').query(
      `UPDATE subscription SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = 'Revisión de la cuenta'
        WHERE tenant_id = $1`,
      [g.barberia.tenantId],
    );

    await solicitudDeEnlace(prueba, 'confirmar', aConfirmar.enlace('CONFIRMAR'), ip).expect(200);
    await solicitudDeEnlace(prueba, 'cancelar', aCancelar.enlace('CANCELAR'), ip).expect(200);
    const token = aReprogramar.enlace('REPROGRAMAR');
    const { body } = await solicitudDeEnlace(prueba, 'reprogramar', token, ip, {
      inicio: horaLima(fechaEnDias(4), '10:00'),
    }).expect(403);
    expect(body.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect(await usosDeEnlace(aReprogramar.citaId)).toEqual([]);
    expect((await filaDeCita(aReprogramar.citaId)).version).toBe(1);
  });

  it('una suscripción que no acepta reservas (EXPIRED): confirmar sigue, reprogramar → 403', async () => {
    const g = await barberiaParaReservar();
    const ip = ipUnica();
    const c = await citaConEnlaces(prueba, g, 300);
    await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE tenant_id = $1`, [
      g.barberia.tenantId,
    ]);
    await solicitudDeEnlace(prueba, 'reprogramar', c.enlace('REPROGRAMAR'), ip, {
      inicio: horaLima(fechaEnDias(4), '10:00'),
    }).expect(403);
    await solicitudDeEnlace(prueba, 'confirmar', c.enlace('CONFIRMAR'), ip).expect(200);
  });
});
