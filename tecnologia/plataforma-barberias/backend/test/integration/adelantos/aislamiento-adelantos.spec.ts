import { randomUUID } from 'node:crypto';
import {
  activarAdelanto,
  numeroDeOperacion,
  registrarPago,
  reservar,
  verAdelanto,
  verCaptura,
  verQrDeCita,
} from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { jpeg } from '../../helpers/comprobantes';
import { filasDe, sembrarUsuario } from '../../helpers/fixtures';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T024 de 008 · Aislamiento y privacidad del adelanto (US2-6; FR-011, FR-028; PR31, PR09): otro cliente o el
// propietario de otra barbería reciben 404 en el adelanto, el QR y la captura (sin revelar que existen); el número
// completo solo lo ven el cliente de la cita y su propietario; y ni el número ni el archivo aparecen en la auditoría
// ni en la salida de eventos.

describe('Aislamiento del adelanto (T024, US2)', () => {
  let prueba: AppDePrueba;
  const dia = fechaEnDias(3);

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Barbería con el adelanto activo, una cita pendiente de un cliente y su pago registrado con captura. */
  async function escenario() {
    const e = await barberiaParaReservar();
    const { qr } = await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '10:00'),
    }).expect(201);
    const numero = numeroDeOperacion();
    const captura = jpeg();
    await registrarPago(prueba, cliente.token, body.id, { numero, captura }).expect(201);
    return { e, qr, propietario, cliente, citaId: body.id as string, numero, captura };
  }

  it('el cliente de la cita y su propietario ven el adelanto con el número completo, la captura y el QR', async () => {
    const s = await escenario();
    for (const token of [s.cliente.token, s.propietario]) {
      const adelanto = await verAdelanto(prueba, token, s.citaId).expect(200);
      expect(adelanto.body.pago).toMatchObject({ numeroOperacion: s.numero, tieneCaptura: true });
      const captura = await verCaptura(prueba, token, s.citaId).expect(200);
      expect((captura.body as Buffer).equals(s.captura)).toBe(true);
      expect(captura.headers['content-type']).toBe('image/jpeg');
      expect(captura.headers['cache-control']).toBe('no-store');
      expect(captura.headers['x-content-type-options']).toBe('nosniff');
      expect(captura.headers['content-disposition']).toMatch(/^attachment;/);
      const qr = await verQrDeCita(prueba, token, s.citaId).expect(200);
      expect((qr.body as Buffer).equals(s.qr)).toBe(true);
      expect(qr.headers['cache-control']).toBe('no-store');
      expect(qr.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  it('otro cliente de la misma barbería recibe 404 en el adelanto, el QR y la captura, como con una cita inexistente', async () => {
    const s = await escenario();
    const otro = await sesionCliente(s.e.barberia.tenantId);
    const inexistente = (await verAdelanto(prueba, otro.token, randomUUID()).expect(404)).body;
    expect((await verAdelanto(prueba, otro.token, s.citaId).expect(404)).body).toEqual(inexistente);
    const qr = await verQrDeCita(prueba, otro.token, s.citaId).expect(404);
    expect(JSON.parse((qr.body as Buffer).toString('utf8')).codigo).toBe('NO_ENCONTRADO');
    await verCaptura(prueba, otro.token, s.citaId).expect(404);
  });

  it('el propietario de otra barbería recibe 404 en las tres rutas', async () => {
    const s = await escenario();
    const otra = await barberiaParaReservar();
    const ajeno = await tokenPara(otra.barberia.tenantId, otra.barberia.propietarioId, 'PROPIETARIO');
    await verAdelanto(prueba, ajeno, s.citaId).expect(404);
    await verQrDeCita(prueba, ajeno, s.citaId).expect(404);
    await verCaptura(prueba, ajeno, s.citaId).expect(404);
  });

  it('el barbero no ve el adelanto ni sus archivos (403)', async () => {
    const s = await escenario();
    const barbero = await sembrarUsuario({
      tenantId: s.e.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'ACTIVA',
    });
    const token = await tokenPara(s.e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    await verAdelanto(prueba, token, s.citaId).expect(403);
    await verQrDeCita(prueba, token, s.citaId).expect(403);
    await verCaptura(prueba, token, s.citaId).expect(403);
  });

  it('una cita sin pago registrado no tiene captura (404); una cita sin adelanto tampoco tiene adelanto (404)', async () => {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const cliente = await sesionCliente(e.barberia.tenantId);
    const { body } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.barberoId,
      inicio: horaLima(dia, '11:00'),
    }).expect(201);
    await verCaptura(prueba, cliente.token, body.id).expect(404);
    // Sin adelanto (la barbería lo desactiva): la cita confirmada no tiene adelanto.
    await poolDe('seed').query('UPDATE booking_deposit_settings SET enabled = false WHERE tenant_id = $1', [
      e.barberia.tenantId,
    ]);
    const { body: sinAdelanto } = await reservar(prueba, cliente.token, {
      servicioId: e.servicioId,
      barberoId: e.otroBarberoId,
      inicio: horaLima(dia, '12:00'),
    }).expect(201);
    await verAdelanto(prueba, cliente.token, sinAdelanto.id).expect(404);
  });

  it('el número de operación y el archivo no aparecen en la auditoría ni en la salida de eventos', async () => {
    const s = await escenario();
    const auditoria = JSON.stringify(await filasDe('audit_log', s.e.barberia.tenantId));
    const eventos = JSON.stringify(await filasDe('outbox_event', s.e.barberia.tenantId));
    const { rows } = await poolDe('seed').query<{ id: string; sha256: string }>(
      `SELECT id, sha256 FROM booking_deposit_file WHERE tenant_id = $1 AND kind = 'CAPTURA'`,
      [s.e.barberia.tenantId],
    );
    for (const texto of [auditoria, eventos]) {
      expect(texto).not.toContain(s.numero);
      expect(texto).not.toContain(rows[0].id);
      expect(texto).not.toContain(rows[0].sha256);
    }
  });
});
