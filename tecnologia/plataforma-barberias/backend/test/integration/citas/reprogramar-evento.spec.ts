import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarbero, sembrarCita, sembrarDisponibilidad, sembrarUsuario } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  SEMANA_COMPLETA,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T043 · Evento CitaReprogramada (FR-010; contracts/eventos.md §3). Una reprogramación con cambio inserta el
// evento en outbox_event en la MISMA transacción, con el payload del contrato y sin datos de contacto. Una
// reprogramación rechazada o sin cambio no publica nada. Desde la fase 3 lo maneja M05 (avisos): queda PROCESADO.

const CAMPOS_PAYLOAD = [
  'barbero',
  'barberoUsuarioId',
  'citaId',
  'clienteId',
  'fin',
  'inicio',
  'inicioAnterior',
  'reprogramadaPor',
  'servicio',
  'version',
  'zonaHoraria',
];

async function eventosDe(tenantId: string) {
  const { rows } = await poolDe('seed').query<{ type: string; payload: Record<string, unknown> }>(
    `SELECT type, payload FROM outbox_event WHERE tenant_id = $1 AND type = 'CitaReprogramada' ORDER BY created_at`,
    [tenantId],
  );
  return rows;
}

describe('Evento CitaReprogramada (T043, FR-010)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let propietario: string;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dia = fechaEnDias(3);

  const reprogramar = (token: string, citaId: string, cuerpo: object) =>
    prueba.agente.post(`/api/v1/citas/${citaId}/reprogramar`).set(como(token)).send(cuerpo);

  async function clienteConCita(hora: string, barberoId = e.barberoId) {
    const sesion = await sesionCliente(e.barberia.tenantId);
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId,
      servicioId: e.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio: new Date(horaLima(dia, hora)),
    });
    return { ...sesion, citaId };
  }

  beforeEach(async () => {
    // Una barbería por prueba: los eventos se cuentan por tenant.
    e = await barberiaParaReservar();
    propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el cliente reprograma: un CitaReprogramada con el payload del contrato y sin datos de contacto', async () => {
    const c = await clienteConCita('10:00');
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '11:00') }).expect(200);

    const eventos = await eventosDe(e.barberia.tenantId);
    expect(eventos).toHaveLength(1);
    const { payload } = eventos[0];
    expect(payload).toEqual({
      citaId: c.citaId,
      version: 2,
      clienteId: c.cliente.clienteId,
      servicio: 'Servicio sembrado',
      barbero: 'Luis',
      inicioAnterior: horaLima(dia, '10:00'),
      inicio: horaLima(dia, '11:00'),
      fin: horaLima(dia, '11:30'),
      zonaHoraria: 'America/Lima',
      reprogramadaPor: 'CLIENTE',
    });
    expect(Object.keys(payload).every((campo) => CAMPOS_PAYLOAD.includes(campo))).toBe(true);
    const texto = JSON.stringify(payload);
    if (c.cliente.correo) expect(texto).not.toContain(c.cliente.correo);
    expect(texto).not.toContain('@');
    if (c.cliente.telefono) expect(texto).not.toContain(c.cliente.telefono);
  });

  it('el propietario reprograma a un barbero con usuario: reprogramadaPor PROPIETARIO y barberoUsuarioId', async () => {
    const usuario = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const { barberoId } = await sembrarBarbero({
      tenantId: e.barberia.tenantId,
      nombre: 'Rosa',
      usuarioId: usuario.usuarioId,
      servicios: [e.servicioId],
    });
    await sembrarDisponibilidad(e.barberia.tenantId, barberoId, SEMANA_COMPLETA);
    const c = await clienteConCita('12:00');
    await reprogramar(propietario, c.citaId, { inicio: horaLima(dia, '13:00'), barberoId }).expect(200);

    const [evento] = await eventosDe(e.barberia.tenantId);
    expect(evento.payload).toMatchObject({
      citaId: c.citaId,
      barbero: 'Rosa',
      barberoUsuarioId: usuario.usuarioId,
      reprogramadaPor: 'PROPIETARIO',
      inicioAnterior: horaLima(dia, '12:00'),
      inicio: horaLima(dia, '13:00'),
    });
  });

  it('el evento se confirma con la reprogramación: queda en outbox_event y M05 lo procesa (fase 3)', async () => {
    const c = await clienteConCita('14:00');
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '14:30') }).expect(200);
    const { rows } = await poolDe('seed').query(
      `SELECT status FROM outbox_event WHERE tenant_id = $1 AND type = 'CitaReprogramada'`,
      [e.barberia.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PROCESADO');
  });

  it('ni la reprogramación rechazada (409, 422, 403) ni la que no cambia nada publican', async () => {
    const c = await clienteConCita('15:00');
    await clienteConCita('16:00');
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '16:00') }).expect(409);
    await reprogramar(c.token, c.citaId, { inicio: horaLima(fechaEnDias(-1), '10:00') }).expect(422);
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '15:00') }).expect(200);
    await poolDe('seed').query(`UPDATE subscription SET status = 'EXPIRED' WHERE tenant_id = $1`, [
      e.barberia.tenantId,
    ]);
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '17:00') }).expect(403);
    expect(await eventosDe(e.barberia.tenantId)).toEqual([]);
  });
});
