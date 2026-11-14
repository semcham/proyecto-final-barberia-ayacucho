import type { PoolClient } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import {
  type BarberiaSembrada,
  type Filas005,
  sembrarBarberia,
  sembrarFilas005,
  TABLAS_005_CON_BARBERIA,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T001 de 005 · PR09, FR-004, FR-025: una prueba por tabla nueva con barbería. Con el tenant de A,
// barberias_app no lee ni modifica la fila de B, un INSERT con el tenant de B falla por WITH CHECK (también la
// suma atómica de la cuota con ON CONFLICT) y no se borra nada. Los permisos exactos y la lista de columnas los
// prueba esquema-asistente.spec.ts (T002).

interface Sembrado extends Filas005 {
  barberia: BarberiaSembrada;
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
  const filas = await sembrarFilas005({ tenantId: barberia.tenantId, usuarioId: barberia.propietarioId });
  return { barberia, ...filas };
}

/** Por tabla: cómo se lee y se modifica la fila de B, y un INSERT con el tenant de B. */
interface CasoDeTabla {
  tabla: string;
  leer: (b: Sembrado) => [string, unknown[]];
  /** UPDATE permitido a barberias_app; null si la tabla no admite UPDATE (registro inmutable). */
  modificar: ((b: Sembrado) => [string, unknown[]]) | null;
  insertar: (b: Sembrado) => [string, unknown[]];
}

const CASOS: CasoDeTabla[] = [
  {
    tabla: 'assistant_quota',
    leer: (b) => [
      `SELECT used FROM assistant_quota WHERE tenant_id = $1 AND scope = 'BARBERIA' AND day = $2`,
      [b.barberia.tenantId, b.dia],
    ],
    modificar: (b) => [
      `UPDATE assistant_quota SET used = used + 1, updated_at = now()
        WHERE tenant_id = $1 AND scope = 'BARBERIA' AND day = $2`,
      [b.barberia.tenantId, b.dia],
    ],
    // Otro día, para que lo único que pueda fallar sea la política (no la clave primaria).
    insertar: (b) => [
      `INSERT INTO assistant_quota (tenant_id, scope, subject_id, day, used) VALUES ($1, 'BARBERIA', $1, '2026-11-01', 0)`,
      [b.barberia.tenantId],
    ],
  },
  {
    tabla: 'assistant_question',
    leer: (b) => ['SELECT id FROM assistant_question WHERE id = $1', [b.preguntaId]],
    modificar: null,
    insertar: (b) => [
      `INSERT INTO assistant_question (id, tenant_id, user_id, role, intent, result, duration_ms)
       VALUES ($1, $2, $3, 'CLIENTE', 'servicios', 'RESPONDIDA', 10)`,
      [uuidv7(), b.barberia.tenantId, b.barberia.propietarioId],
    ],
  },
];

describe('PR09 · Aislamiento de las tablas nuevas de 005 (FR-004, FR-025)', () => {
  let a: Sembrado;
  let b: Sembrado;

  beforeAll(async () => {
    a = await sembrar();
    b = await sembrar();
  });

  afterAll(cerrarPools);

  it('los casos cubren exactamente las dos tablas nuevas', () => {
    expect(CASOS.map((c) => c.tabla).sort()).toEqual([...TABLAS_005_CON_BARBERIA].sort());
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
        // Registro inmutable para la aplicación: ningún UPDATE, ni siquiera sobre las filas propias.
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

  describe('la suma atómica de la cuota (research R08) no cruza barberías', () => {
    const SUMA = `INSERT INTO assistant_quota (tenant_id, scope, subject_id, day, used)
                  VALUES ($1, 'BARBERIA', $1, $2, 1)
                  ON CONFLICT (tenant_id, scope, subject_id, day)
                  DO UPDATE SET used = assistant_quota.used + 1, updated_at = now()
                  WHERE assistant_quota.used < $3
                  RETURNING used`;

    it('con el tenant de A, sumar sobre la clave de B falla por WITH CHECK y la fila de B no cambia', async () => {
      await expect(
        comoApp(a.barberia.tenantId, (c) => c.query(SUMA, [b.barberia.tenantId, b.dia, 200])),
      ).rejects.toThrow(/row-level security/);
      const { rows } = await poolDe('seed').query<{ used: number }>(
        `SELECT used FROM assistant_quota WHERE tenant_id = $1 AND scope = 'BARBERIA' AND day = $2`,
        [b.barberia.tenantId, b.dia],
      );
      expect(rows[0].used).toBe(3);
    });

    it('con el tenant de A, la suma sobre su propia fila funciona y respeta el límite', async () => {
      const resultado = await comoApp(a.barberia.tenantId, async (c) => {
        const bajoElLimite = await c.query<{ used: number }>(SUMA, [a.barberia.tenantId, a.dia, 200]);
        const enElLimite = await c.query<{ used: number }>(SUMA, [a.barberia.tenantId, a.dia, 4]);
        return [bajoElLimite.rows, enElLimite.rows];
      });
      // Sembrada en 3: sube a 4 y, con límite 4, la siguiente no devuelve fila (cuota agotada).
      expect(resultado).toEqual([[{ used: 4 }], []]);
    });
  });

  describe('la cuota de barbería solo puede tener como sujeto a la propia barbería', () => {
    it('la cuota de barbería de A con el tenant de B como sujeto falla por su CHECK', async () => {
      await expect(
        comoApp(a.barberia.tenantId, (c) =>
          c.query(
            `INSERT INTO assistant_quota (tenant_id, scope, subject_id, day, used)
             VALUES ($1, 'BARBERIA', $2, '2026-11-02', 0)`,
            [a.barberia.tenantId, b.barberia.tenantId],
          ),
        ),
      ).rejects.toThrow(/assistant_quota_sujeto_barberia/);
    });
  });
});
