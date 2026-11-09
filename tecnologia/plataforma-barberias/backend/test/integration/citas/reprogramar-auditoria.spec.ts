import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarCita } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T044 · Auditoría de la reprogramación (FR-035; data-model §6, sin cambios de esquema). Una reprogramación con
// cambio deja UNA entrada CITA_REPROGRAMADA en el audit_log de la barbería de la cita, con el actor (cliente o
// propietario) y, en el recurso, la cita, la vía y las horas anterior y nueva:
//   cita:<id>;SESION;<anterior>><nueva>   (horas en UTC, AAAAMMDDTHHMMZ: caben en los 80 caracteres de resource)
// Sin teléfono ni correo. Una reprogramación rechazada (409, 422 o 403) o sin cambio no deja ninguna.

/** 2026-11-12T15:00:00.000Z → 20261112T1500Z */
const compacta = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\d{2}\.\d{3}Z$/, 'Z');

async function auditoriasDeReprogramacion(tenantId: string) {
  return (await filasDe('audit_log', tenantId)).filter((f) => f.action === 'CITA_REPROGRAMADA');
}

describe('Auditoría de la reprogramación (T044, FR-035)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dia = fechaEnDias(3);

  const reprogramar = (token: string, citaId: string, cuerpo: object) =>
    prueba.agente.post(`/api/v1/citas/${citaId}/reprogramar`).set(como(token)).send(cuerpo);

  async function clienteConCita(hora: string) {
    const sesion = await sesionCliente(e.barberia.tenantId);
    const citaId = await sembrarCita({
      tenantId: e.barberia.tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId: sesion.cliente.clienteId,
      inicio: new Date(horaLima(dia, hora)),
    });
    return { ...sesion, citaId };
  }

  beforeAll(async () => {
    prueba = await crearApp();
  });

  beforeEach(async () => {
    e = await barberiaParaReservar();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el cliente reprograma: una entrada con su barbería, el cliente como actor, la vía y las dos horas', async () => {
    const c = await clienteConCita('10:00');
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '11:30') }).expect(200);

    const entradas = await auditoriasDeReprogramacion(e.barberia.tenantId);
    expect(entradas).toHaveLength(1);
    const recurso = `cita:${c.citaId};SESION;${compacta(horaLima(dia, '10:00'))}>${compacta(horaLima(dia, '11:30'))}`;
    expect(recurso.length).toBeLessThanOrEqual(80);
    expect(entradas[0]).toMatchObject({
      tenant_id: e.barberia.tenantId,
      actor_id: c.cliente.usuarioId,
      action: 'CITA_REPROGRAMADA',
      resource: recurso,
      result: 'PERMITIDO',
      reason: null,
    });
    const texto = JSON.stringify(entradas[0]);
    if (c.cliente.correo) expect(texto).not.toContain(c.cliente.correo);
    if (c.cliente.telefono) expect(texto).not.toContain(c.cliente.telefono);

    // Ninguna otra barbería recibe la entrada.
    const otra = await barberiaParaReservar();
    expect(await auditoriasDeReprogramacion(otra.barberia.tenantId)).toEqual([]);
  });

  it('el propietario reprograma: el actor es el propietario', async () => {
    const c = await clienteConCita('12:00');
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    await reprogramar(propietario, c.citaId, {
      inicio: horaLima(dia, '12:30'),
      barberoId: e.otroBarberoId,
    }).expect(200);
    const entradas = await auditoriasDeReprogramacion(e.barberia.tenantId);
    expect(entradas).toHaveLength(1);
    expect(entradas[0]).toMatchObject({
      actor_id: e.barberia.propietarioId,
      resource: `cita:${c.citaId};SESION;${compacta(horaLima(dia, '12:00'))}>${compacta(horaLima(dia, '12:30'))}`,
    });
  });

  it('rechazada (409, 422, 403) o sin cambio: ninguna entrada CITA_REPROGRAMADA', async () => {
    const c = await clienteConCita('14:00');
    await clienteConCita('15:00');
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '15:00') }).expect(409);
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '20:00') }).expect(422);
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '14:00') }).expect(200);
    await poolDe('seed').query(
      `UPDATE subscription SET status = 'SUSPENDED', suspended_at = now(),
       suspension_reason = 'Revisión de la cuenta' WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );
    await reprogramar(c.token, c.citaId, { inicio: horaLima(dia, '16:00') }).expect(403);
    expect(await auditoriasDeReprogramacion(e.barberia.tenantId)).toEqual([]);
  });
});
