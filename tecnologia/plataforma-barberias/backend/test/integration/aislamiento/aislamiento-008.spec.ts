import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  type Filas008,
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarFilas008,
  sembrarServicio,
  TABLAS_008_CON_BARBERIA,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T004 de 008 · PR09, FR-028: una prueba por tabla nueva con barbería. Con el tenant de A, barberias_app no
// lee ni modifica la fila de B, y un INSERT con el tenant de B falla por WITH CHECK. Además, los permisos de
// barberias_app sobre las cuatro tablas son exactamente los de data-model §7 (sin DELETE en ninguna, sin UPDATE
// en los archivos), escritos aquí a mano desde el modelo de datos, y las claves foráneas compuestas impiden
// apuntar a filas de otra barbería.

const DIA_MS = 24 * 60 * 60 * 1000;

interface Sembrado extends Filas008 {
  barberia: BarberiaSembrada;
  clienteId: string;
  usuarioClienteId: string;
  citaId: string;
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
  const { clienteId, usuarioId } = await sembrarCliente({ tenantId });
  const citaId = await sembrarCita({
    tenantId,
    barberoId,
    servicioId,
    clienteId,
    estado: 'PENDIENTE',
    inicio: new Date(Date.now() + 2 * DIA_MS),
  });
  const usuarioClienteId = usuarioId as string;
  const filas = await sembrarFilas008({
    tenantId,
    citaId,
    clienteId,
    usuarioClienteId,
    usuarioId: barberia.propietarioId,
  });
  return { barberia, clienteId, usuarioClienteId, citaId, ...filas };
}

/** Por tabla: cómo se lee y se modifica la fila de B, y un INSERT con el tenant de B. */
interface CasoDeTabla {
  tabla: string;
  leer: (b: Sembrado) => [string, unknown[]];
  /** UPDATE permitido a barberias_app; null si la tabla no admite UPDATE (inmutable). */
  modificar: ((b: Sembrado) => [string, unknown[]]) | null;
  insertar: (b: Sembrado) => [string, unknown[]];
}

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

const CASOS: CasoDeTabla[] = [
  {
    tabla: 'booking_deposit_settings',
    leer: (b) => [
      'SELECT tenant_id FROM booking_deposit_settings WHERE tenant_id = $1',
      [b.barberia.tenantId],
    ],
    modificar: (b) => [
      'UPDATE booking_deposit_settings SET enabled = false WHERE tenant_id = $1',
      [b.barberia.tenantId],
    ],
    insertar: (b) => [
      `INSERT INTO booking_deposit_settings (tenant_id, enabled, updated_by) VALUES ($1, false, $2)`,
      [b.barberia.tenantId, b.barberia.propietarioId],
    ],
  },
  {
    tabla: 'booking_deposit_file',
    leer: (b) => ['SELECT id FROM booking_deposit_file WHERE id = $1', [b.qrId]],
    modificar: null,
    insertar: (b) => [
      `INSERT INTO booking_deposit_file (id, tenant_id, kind, content_type, size_bytes, sha256, content, created_by)
       VALUES ($1, $2, 'QR', 'image/png', 4, repeat('a', 64), $3, $4)`,
      [uuidv7(), b.barberia.tenantId, PNG, b.barberia.propietarioId],
    ],
  },
  {
    tabla: 'booking_deposit',
    leer: (b) => ['SELECT id FROM booking_deposit WHERE id = $1', [b.adelantoId]],
    modificar: (b) => [
      `UPDATE booking_deposit SET status = 'POR_DEVOLVER', resolved_at = now() WHERE id = $1`,
      [b.adelantoId],
    ],
    insertar: (b) => [
      `INSERT INTO booking_deposit (id, tenant_id, appointment_id, customer_id, customer_user_id, code, amount_cents,
         service_price_cents, service_name, starts_at, time_zone, qr_file_id, due_at, review_limit_at)
       VALUES ($1, $2, $3, $4, $5, 'XYZ789', 1000, 2000, 'Corte', now() + interval '2 days', 'America/Lima', $6,
         now() + interval '30 minutes', now() + interval '1 day')`,
      [uuidv7(), b.barberia.tenantId, b.citaId, b.clienteId, b.usuarioClienteId, b.qrId],
    ],
  },
  {
    tabla: 'booking_deposit_payment',
    leer: (b) => ['SELECT id FROM booking_deposit_payment WHERE id = $1', [b.pagoAdelantoId]],
    modificar: (b) => [
      `UPDATE booking_deposit_payment SET review_result = 'CONFIRMADO', reviewed_at = now(), reviewed_by = $2
        WHERE id = $1`,
      [b.pagoAdelantoId, b.barberia.propietarioId],
    ],
    insertar: (b) => [
      `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, registered_by)
       VALUES ($1, $2, $3, 'ATAQUE1234', $4)`,
      [uuidv7(), b.barberia.tenantId, b.adelantoId, b.usuarioClienteId],
    ],
  },
];

describe('PR09 · Aislamiento de las tablas nuevas de 008 (FR-028)', () => {
  let a: Sembrado;
  let b: Sembrado;

  beforeAll(async () => {
    a = await sembrar();
    b = await sembrar();
  });

  afterAll(cerrarPools);

  it('los casos cubren exactamente las cuatro tablas nuevas', () => {
    expect(CASOS.map((c) => c.tabla).sort()).toEqual([...TABLAS_008_CON_BARBERIA].sort());
  });

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
        // Con el tenant de B, la misma sentencia sí la alcanza (la prueba no pasa por un WHERE vacío).
        const propias = await comoApp(b.barberia.tenantId, (c) => c.query(sentencia, parametros));
        expect(propias.rowCount).toBe(1);
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

    it('ningún DELETE, ni siquiera de las filas propias', async () => {
      await expect(comoApp(a.barberia.tenantId, (c) => c.query(`DELETE FROM ${caso.tabla}`))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('claves foráneas compuestas: una fila de A no puede apuntar a filas de B', () => {
    const VIOLACION_FK = /foreign key/;

    it('un adelanto de A para la cita de B falla', async () => {
      await expect(
        comoApp(a.barberia.tenantId, (c) =>
          c.query(
            `INSERT INTO booking_deposit (id, tenant_id, appointment_id, customer_id, customer_user_id, code,
               amount_cents, service_price_cents, service_name, starts_at, time_zone, qr_file_id, due_at,
               review_limit_at)
             VALUES ($1, $2, $3, $4, $5, 'XYZ789', 1000, 2000, 'Corte', now() + interval '2 days', 'America/Lima', $6,
               now() + interval '30 minutes', now() + interval '1 day')`,
            [uuidv7(), a.barberia.tenantId, b.citaId, a.clienteId, a.usuarioClienteId, a.qrId],
          ),
        ),
      ).rejects.toThrow(VIOLACION_FK);
    });

    it('la configuración de A con el QR de B falla', async () => {
      await expect(
        comoApp(a.barberia.tenantId, (c) =>
          c.query(`UPDATE booking_deposit_settings SET qr_file_id = $1 WHERE tenant_id = $2`, [
            b.qrId,
            a.barberia.tenantId,
          ]),
        ),
      ).rejects.toThrow(VIOLACION_FK);
    });

    it('un pago de A sobre el adelanto o la captura de B falla', async () => {
      await expect(
        comoApp(a.barberia.tenantId, (c) =>
          c.query(
            `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, registered_by)
             VALUES ($1, $2, $3, 'CRUZADO1234', $4)`,
            [uuidv7(), a.barberia.tenantId, b.adelantoId, a.usuarioClienteId],
          ),
        ),
      ).rejects.toThrow(VIOLACION_FK);
      await expect(
        comoApp(a.barberia.tenantId, async (c) => {
          // Sin un registro vigente en A, para que lo único que falle sea la captura de B.
          await c.query(
            `UPDATE booking_deposit_payment SET review_result = 'RECHAZADO', reviewed_at = now(), reviewed_by = $2,
               rejection_reason = 'No llegó el pago' WHERE id = $1`,
            [a.pagoAdelantoId, a.barberia.propietarioId],
          );
          return c.query(
            `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, file_id, registered_by)
             VALUES ($1, $2, $3, 'CRUZADO5678', $4, $5)`,
            [uuidv7(), a.barberia.tenantId, a.adelantoId, b.capturaId, a.usuarioClienteId],
          );
        }),
      ).rejects.toThrow(VIOLACION_FK);
    });
  });

  describe('unicidad dentro de cada barbería (research R07)', () => {
    it('el mismo número de operación y el mismo código valen en otra barbería', async () => {
      const resultado = await comoApp(a.barberia.tenantId, async (c) => {
        // Un segundo registro vigente sobre el adelanto de A fallaría (uno solo por adelanto): se rechaza antes.
        await c.query(
          `UPDATE booking_deposit_payment SET review_result = 'RECHAZADO', reviewed_at = now(), reviewed_by = $2,
             rejection_reason = 'No llegó el pago' WHERE id = $1`,
          [a.pagoAdelantoId, a.barberia.propietarioId],
        );
        return c.query(
          `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, registered_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [uuidv7(), a.barberia.tenantId, a.adelantoId, b.numeroOperacion, a.usuarioClienteId],
        );
      });
      expect(resultado.rowCount).toBe(1);
    });

    it('el mismo número de operación se rechaza dentro de la barbería, también si su registro fue rechazado', async () => {
      await expect(
        comoApp(a.barberia.tenantId, async (c) => {
          await c.query(
            `UPDATE booking_deposit_payment SET review_result = 'RECHAZADO', reviewed_at = now(), reviewed_by = $2,
               rejection_reason = 'No llegó el pago' WHERE id = $1`,
            [a.pagoAdelantoId, a.barberia.propietarioId],
          );
          return c.query(
            `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, registered_by)
             VALUES ($1, $2, $3, $4, $5)`,
            [uuidv7(), a.barberia.tenantId, a.adelantoId, a.numeroOperacion, a.usuarioClienteId],
          );
        }),
      ).rejects.toThrow(/booking_deposit_payment_numero_unico|duplicate key/);
    });

    it('un solo registro vigente por adelanto (US2-5)', async () => {
      await expect(
        comoApp(a.barberia.tenantId, (c) =>
          c.query(
            `INSERT INTO booking_deposit_payment (id, tenant_id, deposit_id, operation_number, registered_by)
             VALUES ($1, $2, $3, 'OTRONUMERO1', $4)`,
            [uuidv7(), a.barberia.tenantId, a.adelantoId, a.usuarioClienteId],
          ),
        ),
      ).rejects.toThrow(/booking_deposit_payment_uno_vigente/);
    });
  });
});

// data-model §7 de 008: permisos de los roles de base sobre las tablas nuevas.

interface PermisosEsperados {
  tabla: readonly string[];
  update: readonly string[];
}

const ESPERADOS: Record<string, PermisosEsperados> = {
  booking_deposit_settings: {
    tabla: ['SELECT', 'INSERT'],
    update: [
      'enabled',
      'kind',
      'amount_cents',
      'percent',
      'payment_window_minutes',
      'qr_file_id',
      'updated_at',
      'updated_by',
    ],
  },
  booking_deposit_file: { tabla: ['SELECT', 'INSERT'], update: [] },
  booking_deposit: {
    tabla: ['SELECT', 'INSERT'],
    update: ['status', 'resolved_at', 'refunded_at', 'refunded_by', 'service_name', 'starts_at', 'time_zone'],
  },
  booking_deposit_payment: {
    tabla: ['SELECT', 'INSERT'],
    update: ['review_result', 'reviewed_at', 'reviewed_by', 'rejection_reason'],
  },
};

async function privilegiosDeTabla(rol: string, tabla: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ privilegio: string }>(
    `SELECT privilege_type AS privilegio FROM information_schema.table_privileges
      WHERE grantee = $1 AND table_schema = 'public' AND table_name = $2`,
    [rol, tabla],
  );
  return rows.map((f) => f.privilegio).sort();
}

/** Columnas con el privilegio (propio o heredado de un permiso de tabla completa). */
async function columnasCon(rol: string, tabla: string, privilegio: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ columna: string }>(
    `SELECT a.attname AS columna
       FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege($1, c.oid, a.attnum, $3)`,
    [rol, tabla, privilegio],
  );
  return rows.map((f) => f.columna).sort();
}

describe('PR09 · Permisos de los roles de base sobre las tablas de 008 (data-model §7)', () => {
  afterAll(cerrarPools);

  it.each(Object.entries(ESPERADOS))(
    'barberias_app · %s: exactamente los privilegios de tabla y el UPDATE por columna previstos',
    async (tabla, { tabla: privilegios, update }) => {
      expect(await privilegiosDeTabla('barberias_app', tabla)).toEqual([...privilegios].sort());
      expect(await columnasCon('barberias_app', tabla, 'UPDATE')).toEqual([...update].sort());
    },
  );

  it('barberias_app: ninguna tabla nueva da DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
    const { rows } = await poolDe('seed').query(
      `SELECT table_name, privilege_type FROM information_schema.table_privileges
        WHERE grantee = 'barberias_app' AND table_name = ANY($1)
          AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
      [[...TABLAS_008_CON_BARBERIA]],
    );
    expect(rows).toEqual([]);
  });

  it.each(['barberias_auth', 'barberias_publico'])(
    '%s: ningún permiso sobre ninguna tabla nueva',
    async (rol) => {
      const { rows } = await poolDe('seed').query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
        WHERE grantee = $1 AND table_name = ANY($2)
       UNION ALL
       SELECT table_name, privilege_type FROM information_schema.column_privileges
        WHERE grantee = $1 AND table_name = ANY($2)`,
        [rol, [...TABLAS_008_CON_BARBERIA]],
      );
      expect(rows).toEqual([]);
    },
  );

  it('cada tabla nueva tiene la política tenant_isolation con el tenant de la transacción', async () => {
    const { rows } = await poolDe('seed').query<{ tabla: string; usando: string; comprobando: string }>(
      `SELECT tablename AS tabla, qual AS usando, with_check AS comprobando FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'tenant_isolation' AND tablename = ANY($1)
        ORDER BY tablename`,
      [[...TABLAS_008_CON_BARBERIA]],
    );
    expect(rows.map((f) => f.tabla)).toEqual([...TABLAS_008_CON_BARBERIA].sort());
    for (const fila of rows) {
      expect(fila.usando).toContain("current_setting('app.tenant_id'");
      expect(fila.comprobando).toContain("current_setting('app.tenant_id'");
    }
  });
});
