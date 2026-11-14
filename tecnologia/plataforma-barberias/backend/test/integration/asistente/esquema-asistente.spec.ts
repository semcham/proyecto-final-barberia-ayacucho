import { v7 as uuidv7 } from 'uuid';
import { type BarberiaSembrada, sembrarBarberia, TABLAS_005_CON_BARBERIA } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T002 de 005 · FR-010, SC-007 y data-model §1, §2 y §5: el registro de preguntas NO tiene dónde guardar el texto
// de la pregunta, de la respuesta ni los argumentos (lista exacta de columnas, escrita aquí a mano desde el modelo
// de datos); los CHECK cierran los valores; los permisos de los roles de base son exactamente los previstos.

const COLUMNAS_PREGUNTA = [
  'id',
  'tenant_id',
  'user_id',
  'role',
  'asked_at',
  'intent',
  'result',
  'duration_ms',
  'tokens_in',
  'tokens_out',
];

const COLUMNAS_CUOTA = ['tenant_id', 'scope', 'subject_id', 'day', 'used', 'updated_at'];

const INTENCIONES = [
  'servicios',
  'barberos',
  'horarios_libres',
  'resumen_citas',
  'servicios_mas_pedidos',
  'fuera_de_alcance',
  'accion_no_permitida',
];

const RESULTADOS = [
  'RESPONDIDA',
  'SIN_DATOS',
  'FUERA_DE_ALCANCE',
  'ACCION_NO_PERMITIDA',
  'CUOTA_AGOTADA',
  'PROVEEDOR_NO_DISPONIBLE',
  'INVALIDA',
];

async function columnas(tabla: string): Promise<string[]> {
  const { rows } = await poolDe('seed').query<{ columna: string }>(
    `SELECT column_name AS columna FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tabla],
  );
  return rows.map((f) => f.columna).sort();
}

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

describe('T002 · Esquema del asistente: registro sin texto, valores cerrados y permisos (data-model de 005)', () => {
  let barberia: BarberiaSembrada;

  beforeAll(async () => {
    barberia = await sembrarBarberia();
  });

  afterAll(cerrarPools);

  /** Inserta una pregunta sin RLS con los valores dados sobre unos válidos. */
  const insertarPregunta = (cambios: Record<string, unknown>) => {
    const fila: Record<string, unknown> = {
      id: uuidv7(),
      tenant_id: barberia.tenantId,
      user_id: barberia.propietarioId,
      role: 'PROPIETARIO',
      intent: 'resumen_citas',
      result: 'RESPONDIDA',
      duration_ms: 10,
      ...cambios,
    };
    const nombres = Object.keys(fila);
    return poolDe('seed').query(
      `INSERT INTO assistant_question (${nombres.join(', ')}) VALUES (${nombres.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(fila),
    );
  };

  describe('assistant_question', () => {
    it('tiene exactamente las columnas del modelo de datos, sin pregunta, respuesta ni argumentos', async () => {
      const reales = await columnas('assistant_question');
      expect(reales).toEqual([...COLUMNAS_PREGUNTA].sort());
      // Defensa adicional por si se agrega una columna con otro nombre: ninguna de tipo texto libre largo.
      const { rows } = await poolDe('seed').query<{ columna: string; tipo: string; largo: number | null }>(
        `SELECT column_name AS columna, data_type AS tipo, character_maximum_length AS largo
           FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'assistant_question'
            AND data_type IN ('text', 'character varying', 'json', 'jsonb', 'bytea')`,
      );
      expect(rows.map((f) => f.columna).sort()).toEqual(['intent', 'result', 'role']);
      for (const fila of rows) expect(fila.largo).toBeLessThanOrEqual(32);
    });

    it.each(INTENCIONES)('acepta la intención %s', async (intencion) => {
      await expect(insertarPregunta({ intent: intencion })).resolves.toBeDefined();
    });

    it('acepta una pregunta sin intención (no se llegó a interpretar)', async () => {
      await expect(insertarPregunta({ intent: null, result: 'INVALIDA' })).resolves.toBeDefined();
    });

    it.each(RESULTADOS)('acepta el resultado %s', async (resultado) => {
      await expect(insertarPregunta({ result: resultado })).resolves.toBeDefined();
    });

    it.each([
      ['una intención fuera de la lista', { intent: 'sql' }],
      ['un resultado fuera de la lista', { result: 'OK' }],
      ['el rol BARBERO', { role: 'BARBERO' }],
      ['una duración negativa', { duration_ms: -1 }],
      ['tokens negativos', { tokens_in: -5 }],
    ])('rechaza %s', async (_caso, cambios) => {
      await expect(insertarPregunta(cambios)).rejects.toThrow(/check constraint/);
    });

    it('el usuario debe existir', async () => {
      await expect(insertarPregunta({ user_id: uuidv7() })).rejects.toThrow(/foreign key/);
    });
  });

  describe('assistant_quota', () => {
    it('tiene exactamente las columnas del modelo de datos', async () => {
      expect(await columnas('assistant_quota')).toEqual([...COLUMNAS_CUOTA].sort());
    });

    it('la clave primaria es (tenant_id, scope, subject_id, day)', async () => {
      const { rows } = await poolDe('seed').query<{ columna: string }>(
        `SELECT a.attname AS columna
           FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
          WHERE i.indrelid = 'assistant_quota'::regclass AND i.indisprimary
          ORDER BY array_position(i.indkey, a.attnum)`,
      );
      expect(rows.map((f) => f.columna)).toEqual(['tenant_id', 'scope', 'subject_id', 'day']);
    });

    // Un día distinto por fila, para que lo único que pueda fallar sea el CHECK (no la clave primaria).
    let dia = 0;
    const insertarCuota = (scope: string, sujeto: string, usado: number) =>
      poolDe('seed').query(
        `INSERT INTO assistant_quota (tenant_id, scope, subject_id, day, used) VALUES ($1, $2, $3, $4, $5)`,
        [barberia.tenantId, scope, sujeto, `2026-10-${String(++dia).padStart(2, '0')}`, usado],
      );

    it('acepta la cuota de la barbería (sujeto = barbería) y la de un usuario', async () => {
      await expect(insertarCuota('BARBERIA', barberia.tenantId, 0)).resolves.toBeDefined();
      await expect(insertarCuota('USUARIO', barberia.propietarioId, 1)).resolves.toBeDefined();
    });

    it.each([
      ['un alcance fuera de la lista', () => insertarCuota('PLAN', barberia.tenantId, 0)],
      ['la cuota de barbería con otro sujeto', () => insertarCuota('BARBERIA', uuidv7(), 0)],
      ['un uso negativo', () => insertarCuota('USUARIO', barberia.propietarioId, -1)],
    ])('rechaza %s', async (_caso, insertar) => {
      await expect(insertar()).rejects.toThrow(/check constraint/);
    });
  });

  describe('permisos de los roles de base (data-model §5)', () => {
    it('barberias_app · assistant_quota: SELECT e INSERT, y UPDATE solo de used y updated_at', async () => {
      expect(await privilegiosDeTabla('barberias_app', 'assistant_quota')).toEqual(['INSERT', 'SELECT']);
      expect(await columnasCon('barberias_app', 'assistant_quota', 'UPDATE')).toEqual(['updated_at', 'used']);
    });

    it('barberias_app · assistant_question: SELECT e INSERT, sin UPDATE', async () => {
      expect(await privilegiosDeTabla('barberias_app', 'assistant_question')).toEqual(['INSERT', 'SELECT']);
      expect(await columnasCon('barberias_app', 'assistant_question', 'UPDATE')).toEqual([]);
    });

    it('barberias_app: ninguna tabla nueva da DELETE, TRUNCATE, REFERENCES ni TRIGGER', async () => {
      const { rows } = await poolDe('seed').query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'barberias_app' AND table_name = ANY($1)
            AND privilege_type IN ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')`,
        [[...TABLAS_005_CON_BARBERIA]],
      );
      expect(rows).toEqual([]);
    });

    it.each(['barberias_auth', 'barberias_publico', 'barberias_plataforma'])(
      '%s: ningún permiso sobre ninguna tabla nueva',
      async (rol) => {
        const { rows } = await poolDe('seed').query(
          `SELECT table_name, privilege_type FROM information_schema.table_privileges
            WHERE grantee = $1 AND table_name = ANY($2)
           UNION ALL
           SELECT table_name, privilege_type FROM information_schema.column_privileges
            WHERE grantee = $1 AND table_name = ANY($2)`,
          [rol, [...TABLAS_005_CON_BARBERIA]],
        );
        expect(rows).toEqual([]);
      },
    );

    it('ningún rol con el que se conecta la aplicación tiene BYPASSRLS ni es superusuario', async () => {
      const { rows } = await poolDe('seed').query<{ rol: string; bypass: boolean; superusuario: boolean }>(
        `SELECT rolname AS rol, rolbypassrls AS bypass, rolsuper AS superusuario FROM pg_roles
          WHERE rolname IN ('barberias_app', 'barberias_publico', 'barberias_plataforma')
          ORDER BY rolname`,
      );
      expect(rows).toHaveLength(3);
      for (const fila of rows) expect(fila).toEqual({ rol: fila.rol, bypass: false, superusuario: false });
    });

    it('barberias_auth (BYPASSRLS desde 001, migración 0003) no puede conectarse ni tocar las tablas nuevas', async () => {
      // Es el dueño NOLOGIN de las tres funciones SECURITY DEFINER de autenticación (ADR-015): ninguna conexión de
      // la aplicación lo usa, no tiene permisos sobre las tablas de 005 (prueba anterior) y ninguna de sus funciones
      // las nombra.
      const rol = await poolDe('seed').query<{ login: boolean }>(
        `SELECT rolcanlogin AS login FROM pg_roles WHERE rolname = 'barberias_auth'`,
      );
      expect(rol.rows).toEqual([{ login: false }]);
      const { rows } = await poolDe('seed').query<{ funcion: string }>(
        `SELECT p.proname AS funcion FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE r.rolname = 'barberias_auth' AND p.prosrc ~ 'assistant_(quota|question)'`,
      );
      expect(rows).toEqual([]);
    });

    it('ninguna tabla nueva tiene otra política además de tenant_isolation (nada para la plataforma)', async () => {
      const { rows } = await poolDe('seed').query<{ tabla: string; politica: string }>(
        `SELECT tablename AS tabla, policyname AS politica FROM pg_policies
          WHERE schemaname = 'public' AND tablename = ANY($1) ORDER BY tablename`,
        [[...TABLAS_005_CON_BARBERIA]],
      );
      expect(rows).toEqual([
        { tabla: 'assistant_question', politica: 'tenant_isolation' },
        { tabla: 'assistant_quota', politica: 'tenant_isolation' },
      ]);
    });
  });
});
