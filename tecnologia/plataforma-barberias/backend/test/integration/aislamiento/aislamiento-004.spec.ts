import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  type Filas004,
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarFilas004,
  sembrarServicio,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T010 de 004 · PR09, FR-034: una prueba por tabla nueva con barbería. Con el tenant de A, barberias_app no
// lee ni modifica la fila de B, y un INSERT con el tenant de B falla por WITH CHECK.

const DIA_MS = 24 * 60 * 60 * 1000;

interface Sembrado extends Filas004 {
  barberia: BarberiaSembrada;
  clienteId: string;
  citaId: string;
  barberoId: string;
}

async function comoApp<T>(tenantId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

async function sembrar(): Promise<Sembrado> {
  const barberia = await sembrarBarberia();
  const { tenantId } = barberia;
  const { servicioId } = await sembrarServicio({ tenantId });
  const { barberoId } = await sembrarBarbero({ tenantId, servicios: [servicioId] });
  const { clienteId } = await sembrarCliente({ tenantId });
  const citaId = await sembrarCita({
    tenantId,
    barberoId,
    servicioId,
    clienteId,
    inicio: new Date(Date.now() + 2 * DIA_MS),
  });
  const filas = await sembrarFilas004({
    tenantId,
    clienteId,
    citaId,
    barberoId,
    usuarioId: barberia.propietarioId,
  });
  return { barberia, clienteId, citaId, barberoId, ...filas };
}

/** Por tabla: cómo se lee y se modifica la fila de B, y un INSERT con el tenant de B. */
interface CasoDeTabla {
  tabla: string;
  leer: (b: Sembrado) => [string, unknown[]];
  /** UPDATE permitido a barberias_app; null si la tabla no admite UPDATE (inmutable). */
  modificar: ((b: Sembrado) => [string, unknown[]]) | null;
  insertar: (b: Sembrado) => [string, unknown[]];
}

const CASOS: CasoDeTabla[] = [
  {
    tabla: 'outbox_event',
    leer: (b) => ['SELECT id FROM outbox_event WHERE id = $1', [b.eventoId]],
    modificar: (b) => [`UPDATE outbox_event SET status = 'ANULADO' WHERE id = $1`, [b.eventoId]],
    insertar: (b) => [
      `INSERT INTO outbox_event (id, tenant_id, type, payload, available_at, status, attempts)
       VALUES ($1, $2, 'CitaCreada', '{}', now(), 'PENDIENTE', 0)`,
      [uuidv7(), b.barberia.tenantId],
    ],
  },
  {
    tabla: 'notification',
    leer: (b) => ['SELECT id FROM notification WHERE id = $1', [b.avisoId]],
    modificar: (b) => [`UPDATE notification SET status = 'DESCARTADO' WHERE id = $1`, [b.avisoId]],
    insertar: (b) => [
      `INSERT INTO notification (id, tenant_id, event_id, kind, recipient_kind, recipient_ref, channel_planned,
         status, discard_after)
       VALUES ($1, $2, $3, 'CITA_CREADA', 'PROPIETARIO', $4, 'CORREO', 'PENDIENTE', now() + interval '1 day')`,
      [uuidv7(), b.barberia.tenantId, b.eventoId, b.barberia.propietarioId],
    ],
  },
  {
    tabla: 'customer_notification_preference',
    leer: (b) => [
      'SELECT customer_id FROM customer_notification_preference WHERE customer_id = $1',
      [b.clienteId],
    ],
    modificar: (b) => [
      `UPDATE customer_notification_preference SET channel = 'CORREO' WHERE customer_id = $1`,
      [b.clienteId],
    ],
    insertar: (b) => [
      `INSERT INTO customer_notification_preference (tenant_id, customer_id, channel)
       VALUES ($1, $2, 'CORREO')`,
      [b.barberia.tenantId, b.clienteId],
    ],
  },
  {
    tabla: 'whatsapp_consent',
    leer: (b) => ['SELECT id FROM whatsapp_consent WHERE id = $1', [b.consentimientoId]],
    modificar: (b) => [
      `UPDATE whatsapp_consent SET withdrawn_at = now() WHERE id = $1`,
      [b.consentimientoId],
    ],
    insertar: (b) => [
      `INSERT INTO whatsapp_consent (id, tenant_id, customer_id, number, text_version)
       VALUES ($1, $2, $3, '+51 900000000', '2026-11')`,
      [uuidv7(), b.barberia.tenantId, b.clienteId],
    ],
  },
  {
    tabla: 'appointment_reschedule',
    leer: (b) => ['SELECT id FROM appointment_reschedule WHERE id = $1', [b.reprogramacionId]],
    modificar: null,
    insertar: (b) => [
      `INSERT INTO appointment_reschedule (id, tenant_id, appointment_id, from_barber_id, from_starts_at,
         to_barber_id, to_starts_at, via)
       VALUES ($1, $2, $3, $4, now() + interval '5 days', $4, now() + interval '6 days', 'ENLACE')`,
      [uuidv7(), b.barberia.tenantId, b.citaId, b.barberoId],
    ],
  },
  {
    tabla: 'appointment_link_use',
    leer: (b) => ['SELECT id FROM appointment_link_use WHERE id = $1', [b.usoEnlaceId]],
    modificar: null,
    insertar: (b) => [
      `INSERT INTO appointment_link_use (id, tenant_id, appointment_id, link_hash, action)
       VALUES ($1, $2, $3, $4, 'CANCELAR')`,
      [uuidv7(), b.barberia.tenantId, b.citaId, randomBytes(32).toString('hex')],
    ],
  },
];

describe('PR09 · Aislamiento de las tablas nuevas de 004 (FR-034)', () => {
  let a: Sembrado;
  let b: Sembrado;

  beforeAll(async () => {
    a = await sembrar();
    b = await sembrar();
  });

  afterAll(cerrarPools);

  describe.each(CASOS)('$tabla', (caso) => {
    it('con el tenant de A no se lee la fila de B; con el de B, sí', async () => {
      const [consulta, parametros] = caso.leer(b);
      const desdeA = await comoApp(a.barberia.tenantId, (c) => c.query(consulta, parametros));
      expect(desdeA.rowCount).toBe(0);
      const desdeB = await comoApp(b.barberia.tenantId, (c) => c.query(consulta, parametros));
      expect(desdeB.rowCount).toBe(1);
    });

    it('con el tenant de A no se modifica la fila de B', async () => {
      if (caso.modificar) {
        const [sentencia, parametros] = caso.modificar(b);
        const afectadas = await comoApp(a.barberia.tenantId, (c) => c.query(sentencia, parametros));
        expect(afectadas.rowCount).toBe(0);
      } else {
        // Tabla inmutable para la aplicación: ningún UPDATE, ni siquiera sobre las filas propias.
        await expect(
          comoApp(a.barberia.tenantId, (c) => c.query(`UPDATE ${caso.tabla} SET tenant_id = tenant_id`)),
        ).rejects.toThrow(/permission denied/);
      }
    });

    it('un INSERT con el tenant de B desde el contexto de A falla por WITH CHECK', async () => {
      const [sentencia, parametros] = caso.insertar(b);
      await expect(comoApp(a.barberia.tenantId, (c) => c.query(sentencia, parametros))).rejects.toThrow(
        /row-level security/,
      );
    });
  });

  it('outbox_event: el DELETE de la purga no alcanza las filas de otra barbería', async () => {
    const borradas = await comoApp(a.barberia.tenantId, (c) =>
      c.query('DELETE FROM outbox_event WHERE id = $1', [b.eventoId]),
    );
    expect(borradas.rowCount).toBe(0);
    const sigue = await poolDe('seed').query('SELECT 1 FROM outbox_event WHERE id = $1', [b.eventoId]);
    expect(sigue.rowCount).toBe(1);
  });
});
