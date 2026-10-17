import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarBarbero,
  sembrarBloqueo,
  sembrarCita,
  sembrarCliente,
  sembrarDisponibilidad,
  sembrarHorarioAtencion,
  sembrarServicio,
  sembrarSesion,
  sembrarSuscripcion,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T090 · PR09 a nivel de base: RLS forzada en toda tabla con tenant_id, sin fugas entre barberías.
// T013 (funcionalidad 002): tablas del catálogo, clientes y citas, y RLS de edición en tenant.

const DIA_MS = 24 * 60 * 60 * 1000;

/** Tablas globales con RLS que se leen sin tenant: tenant solo restringe el UPDATE (R15 de 002). */
const RLS_CON_LECTURA_GLOBAL = ['tenant'];

interface CatalogoSembrado {
  servicioId: string;
  barberoId: string;
  clienteId: string;
  citaId: string;
}

async function comoApp<T>(fn: (cliente: PoolClient) => Promise<T>, tenantId?: string): Promise<T> {
  const cliente = await poolDe('app').connect();
  try {
    await cliente.query('BEGIN');
    if (tenantId) await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

describe('PR09 · RLS en la base de datos', () => {
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  let tablasConTenant: string[];
  let tablasConRls: string[];
  const catalogo = new Map<string, CatalogoSembrado>();

  beforeAll(async () => {
    a = await sembrarBarberia();
    b = await sembrarBarberia();
    // Cada barbería con datos en todas las tablas por tenant.
    for (const barberia of [a, b]) {
      const { tenantId } = barberia;
      await sembrarHorarioAtencion(tenantId);
      const { servicioId } = await sembrarServicio({ tenantId });
      const { barberoId } = await sembrarBarbero({ tenantId, servicios: [servicioId] });
      await sembrarDisponibilidad(tenantId, barberoId);
      const manana = new Date(Date.now() + DIA_MS);
      await sembrarBloqueo({
        tenantId,
        barberoId,
        inicio: manana,
        fin: new Date(manana.getTime() + 3600_000),
      });
      const { clienteId } = await sembrarCliente({ tenantId });
      const citaId = await sembrarCita({
        tenantId,
        barberoId,
        servicioId,
        clienteId,
        inicio: new Date(Date.now() + 2 * DIA_MS),
      });
      await poolDe('seed').query(
        `INSERT INTO appointment_status_history (id, tenant_id, appointment_id, to_status, changed_by)
         VALUES ($1, $2, $3, 'CONFIRMADA', $4)`,
        [uuidv7(), tenantId, citaId, barberia.propietarioId],
      );
      catalogo.set(tenantId, { servicioId, barberoId, clienteId, citaId });
      await sembrarSesion({ tenantId: barberia.tenantId, usuarioId: barberia.propietarioId });
      await sembrarSuscripcion({
        tenantId: barberia.tenantId,
        trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
      });
      const seed = poolDe('seed');
      await seed.query(
        `INSERT INTO audit_log (id, tenant_id, actor_id, action, result) VALUES ($1, $2, $3, 'PRUEBA', 'PERMITIDO')`,
        [uuidv7(), barberia.tenantId, barberia.propietarioId],
      );
      await seed.query(
        `INSERT INTO terms_acceptance (id, tenant_id, user_id, document, text_version) VALUES ($1, $2, $3, 'TERMINOS', '2026-10')`,
        [uuidv7(), barberia.tenantId, barberia.propietarioId],
      );
      await seed.query(
        `INSERT INTO account_activation (id, tenant_id, user_id, token_hash, expires_at, created_by)
         VALUES ($1, $2, $3, $4, now() + interval '72 hours', $3)`,
        [uuidv7(), barberia.tenantId, barberia.propietarioId, uuidv7().replace(/-/g, '').padEnd(64, '0')],
      );
    }

    const seed = poolDe('seed');
    tablasConTenant = (
      await seed.query<{ tabla: string }>(
        `SELECT table_name AS tabla FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY table_name`,
      )
    ).rows.map((fila) => fila.tabla);
    tablasConRls = (
      await seed.query<{ tabla: string }>(
        `SELECT c.relname AS tabla FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
         ORDER BY c.relname`,
      )
    ).rows.map((fila) => fila.tabla);
  });

  afterAll(cerrarPools);

  it('toda tabla con columna tenant_id tiene RLS activada y forzada', () => {
    expect(tablasConTenant.length).toBeGreaterThanOrEqual(6);
    expect(tablasConTenant.filter((tabla) => !tablasConRls.includes(tabla))).toEqual([]);
    // user_account no tiene tenant_id pero también tiene RLS (ADR-015).
    expect(tablasConRls).toContain('user_account');
  });

  it('(a) sin contexto de tenant, barberias_app no ve ninguna fila en ninguna tabla con RLS por tenant', async () => {
    const porTenant = tablasConRls.filter((tabla) => !RLS_CON_LECTURA_GLOBAL.includes(tabla));
    const conteos = await comoApp(async (cliente) => {
      const resultado: Record<string, number> = {};
      for (const tabla of porTenant) {
        resultado[tabla] = (await cliente.query(`SELECT count(*)::int AS total FROM ${tabla}`)).rows[0].total;
      }
      return resultado;
    });
    expect(Object.values(conteos).every((total) => total === 0)).toBe(true);
    expect(Object.keys(conteos).sort()).toEqual([...porTenant].sort());
  });

  it('las tablas nuevas de 002 tienen tenant_id y RLS forzada', () => {
    const nuevas = [
      'customer_profile',
      'consent_record',
      'business_hours',
      'service',
      'barber',
      'barber_service',
      'working_hours',
      'time_off',
      'appointment',
      'appointment_status_history',
    ];
    expect(nuevas.filter((tabla) => !tablasConTenant.includes(tabla))).toEqual([]);
    expect(nuevas.filter((tabla) => !tablasConRls.includes(tabla))).toEqual([]);
  });

  describe('tenant: lectura global, edición solo de la propia barbería (R15 de 002)', () => {
    it('sin contexto se leen las barberías (la usan la autenticación y la vía pública)', async () => {
      const total = await comoApp(
        async (cliente) =>
          (
            await cliente.query('SELECT count(*)::int AS total FROM tenant WHERE id IN ($1, $2)', [
              a.tenantId,
              b.tenantId,
            ])
          ).rows[0].total,
      );
      expect(total).toBe(2);
    });

    it('con el contexto de A, un UPDATE sobre B afecta 0 filas y sobre A, 1', async () => {
      const afectadas = await comoApp(async (cliente) => {
        const sobreB = await cliente.query("UPDATE tenant SET description = 'ataque' WHERE id = $1", [
          b.tenantId,
        ]);
        const sobreA = await cliente.query("UPDATE tenant SET description = 'propia' WHERE id = $1", [
          a.tenantId,
        ]);
        return [sobreB.rowCount, sobreA.rowCount];
      }, a.tenantId);
      expect(afectadas).toEqual([0, 1]);
    });

    it('sin contexto, un UPDATE no afecta ninguna barbería', async () => {
      const afectadas = await comoApp(
        async (cliente) => (await cliente.query("UPDATE tenant SET description = 'ataque'")).rowCount,
      );
      expect(afectadas).toBe(0);
    });

    it('barberias_app no puede cambiar el estado de una barbería (RF02, funcionalidad 003)', async () => {
      await expect(
        comoApp(
          (cliente) => cliente.query("UPDATE tenant SET status = 'SUSPENDIDA' WHERE id = $1", [a.tenantId]),
          a.tenantId,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('claves foráneas compuestas: una fila de A no puede apuntar a filas de B', () => {
    const VIOLACION_FK = /foreign key/;

    it('asignar a un barbero de A un servicio de B falla', async () => {
      const deA = catalogo.get(a.tenantId) as CatalogoSembrado;
      const deB = catalogo.get(b.tenantId) as CatalogoSembrado;
      await expect(
        comoApp(
          (cliente) =>
            cliente.query(
              'INSERT INTO barber_service (tenant_id, barber_id, service_id) VALUES ($1, $2, $3)',
              [a.tenantId, deA.barberoId, deB.servicioId],
            ),
          a.tenantId,
        ),
      ).rejects.toThrow(VIOLACION_FK);
    });

    it('una cita de A con el cliente de B falla', async () => {
      const deA = catalogo.get(a.tenantId) as CatalogoSembrado;
      const deB = catalogo.get(b.tenantId) as CatalogoSembrado;
      await expect(
        comoApp(
          (cliente) =>
            cliente.query(
              `INSERT INTO appointment (id, tenant_id, barber_id, service_id, customer_id, service_name, price,
                 duration_min, starts_at, ends_at, status, origin, created_by)
               VALUES ($1, $2, $3, $4, $5, 'Corte', 20, 30, now() + interval '5 days',
                 now() + interval '5 days 30 minutes', 'CONFIRMADA', 'EN_LINEA', $6)`,
              [uuidv7(), a.tenantId, deA.barberoId, deA.servicioId, deB.clienteId, a.propietarioId],
            ),
          a.tenantId,
        ),
      ).rejects.toThrow(VIOLACION_FK);
    });

    it('vincular a un barbero de A un usuario de B falla', async () => {
      await expect(
        comoApp(
          (cliente) =>
            cliente.query(
              'INSERT INTO barber (id, tenant_id, user_id, display_name) VALUES ($1, $2, $3, $4)',
              [uuidv7(), a.tenantId, b.propietarioId, 'Barbero intruso'],
            ),
          a.tenantId,
        ),
      ).rejects.toThrow(VIOLACION_FK);
    });

    it('INSERT de una cita con el tenant_id de B desde el contexto de A falla por WITH CHECK', async () => {
      const deB = catalogo.get(b.tenantId) as CatalogoSembrado;
      await expect(
        comoApp(
          (cliente) =>
            cliente.query(
              `INSERT INTO appointment (id, tenant_id, barber_id, service_id, customer_id, service_name, price,
                 duration_min, starts_at, ends_at, status, origin, created_by)
               VALUES ($1, $2, $3, $4, $5, 'Corte', 20, 30, now() + interval '6 days',
                 now() + interval '6 days 30 minutes', 'CONFIRMADA', 'EN_LINEA', $6)`,
              [uuidv7(), b.tenantId, deB.barberoId, deB.servicioId, deB.clienteId, a.propietarioId],
            ),
          a.tenantId,
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('las citas y su historial no se pueden borrar desde la aplicación', async () => {
    await expect(comoApp((cliente) => cliente.query('DELETE FROM appointment'), a.tenantId)).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      comoApp((cliente) => cliente.query('DELETE FROM appointment_status_history'), a.tenantId),
    ).rejects.toThrow(/permission denied/);
  });

  it('(b) con el contexto de A no aparece ninguna fila de B, y sí las de A', async () => {
    const resultado = await comoApp(async (cliente) => {
      const filas: Record<string, { deA: number; deB: number }> = {};
      for (const tabla of tablasConTenant) {
        const { rows } = await cliente.query<{ dea: number; deb: number }>(
          `SELECT count(*) FILTER (WHERE tenant_id = $1)::int AS dea, count(*) FILTER (WHERE tenant_id = $2)::int AS deb FROM ${tabla}`,
          [a.tenantId, b.tenantId],
        );
        filas[tabla] = { deA: rows[0].dea, deB: rows[0].deb };
      }
      return filas;
    }, a.tenantId);
    for (const [tabla, { deA, deB }] of Object.entries(resultado)) {
      expect({ tabla, deB }).toEqual({ tabla, deB: 0 });
      expect({ tabla, conDatosDeA: deA > 0 }).toEqual({ tabla, conDatosDeA: true });
    }
  });

  describe('(c) no se puede escribir en B desde el contexto de A', () => {
    it('INSERT con tenant_id de B falla por WITH CHECK', async () => {
      await expect(
        comoApp(
          (cliente) =>
            cliente.query(
              `INSERT INTO audit_log (id, tenant_id, actor_id, action, result) VALUES ($1, $2, NULL, 'ATAQUE', 'DENEGADO')`,
              [uuidv7(), b.tenantId],
            ),
          a.tenantId,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('UPDATE que mueve una fila de A a B falla por WITH CHECK', async () => {
      await expect(
        comoApp(
          (cliente) =>
            cliente.query('UPDATE auth_session SET tenant_id = $1 WHERE tenant_id = $2', [
              b.tenantId,
              a.tenantId,
            ]),
          a.tenantId,
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('UPDATE y DELETE sobre filas de B no afectan ninguna fila', async () => {
      const afectadas = await comoApp(async (cliente) => {
        const actualizadas = await cliente.query(
          "UPDATE membership SET status = 'DESACTIVADA' WHERE tenant_id = $1",
          [b.tenantId],
        );
        const borradas = await cliente.query('DELETE FROM auth_session WHERE tenant_id = $1', [b.tenantId]);
        return [actualizadas.rowCount, borradas.rowCount];
      }, a.tenantId);
      expect(afectadas).toEqual([0, 0]);
    });
  });

  it('(d) barberias_app no tiene BYPASSRLS ni es dueño de ninguna tabla', async () => {
    const seed = poolDe('seed');
    const rol = await seed.query(
      "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'barberias_app'",
    );
    expect(rol.rows[0]).toEqual({ rolbypassrls: false, rolsuper: false });
    const propias = await seed.query("SELECT tablename FROM pg_tables WHERE tableowner = 'barberias_app'");
    expect(propias.rows).toEqual([]);
  });

  it('(e) audit_log es inmutable para la aplicación: UPDATE y DELETE denegados', async () => {
    await expect(
      comoApp((cliente) => cliente.query("UPDATE audit_log SET action = 'BORRADO'"), a.tenantId),
    ).rejects.toThrow(/permission denied/);
    await expect(comoApp((cliente) => cliente.query('DELETE FROM audit_log'), a.tenantId)).rejects.toThrow(
      /permission denied/,
    );
  });
});
