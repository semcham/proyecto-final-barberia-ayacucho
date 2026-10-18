import type { PoolClient } from 'pg';
import { COLUMNAS_PUBLICAS } from '../../../migrations/0012_lectura_publica';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBloqueo, sembrarCita, sembrarCliente, sembrarUsuario } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T064 · PR09 de la vía pública (ADR-021). Seis garantías:
//   1. permisos exactos de barberias_publico (solo SELECT por columna, lista cerrada, sin tenant);
//   2. rol sin privilegios extra (sin BYPASSRLS, sin objetos propios, sin las funciones de ADR-015);
//   3. las columnas privadas fallan en PostgreSQL;
//   4. RLS: con el tenant de A no hay filas de B, y sin tenant no hay ninguna;
//   5. no puede escribir;
//   6. HTTP: los datos canario nunca salen, y un slug inexistente, cambiado o suspendido responde igual.

const TABLAS_PUBLICAS = Object.keys(COLUMNAS_PUBLICAS).sort();

/** Transacción con el rol barberias_publico (y el tenant fijado si se indica); siempre se revierte. */
async function comoPublico<T>(tenantId: string | null, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await poolDe('publico').connect();
  try {
    await cliente.query('BEGIN');
    if (tenantId) await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(cliente);
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
}

describe('PR09 · Lecturas públicas por enlace (ADR-021)', () => {
  let prueba: AppDePrueba;
  let a: BarberiaParaReservar;
  let b: BarberiaParaReservar;
  const fecha = fechaEnDias(3);
  // Datos canario: únicos por ejecución, sembrados en A y en B. Ninguno puede aparecer en /publico/*.
  const sufijo = Date.now().toString(36);
  const canarios = {
    correoClienteA: `canario-cliente-a-${sufijo}@prueba.pe`,
    correoClienteB: `canario-cliente-b-${sufijo}@prueba.pe`,
    telefonoClienteA: `91${String(Date.now()).slice(-7)}`,
    telefonoClienteB: `92${String(Date.now()).slice(-7)}`,
    nombreClienteA: `Canario Cliente A ${sufijo}`,
    correoPersonalA: `canario-personal-a-${sufijo}@prueba.pe`,
    nombrePersonalB: `Canario Personal B ${sufijo}`,
    motivoBloqueoA: `canario motivo A ${sufijo}`,
    motivoBloqueoB: `canario motivo B ${sufijo}`,
  };

  beforeAll(async () => {
    prueba = await crearApp();
    a = await barberiaParaReservar();
    b = await barberiaParaReservar();
    const clienteA = await sembrarCliente({
      tenantId: a.barberia.tenantId,
      correo: canarios.correoClienteA,
      telefono: canarios.telefonoClienteA,
      nombre: canarios.nombreClienteA,
    });
    const clienteB = await sembrarCliente({
      tenantId: b.barberia.tenantId,
      correo: canarios.correoClienteB,
      telefono: canarios.telefonoClienteB,
    });
    await sembrarUsuario({
      tenantId: a.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'ACTIVA',
      correo: canarios.correoPersonalA,
    });
    await sembrarUsuario({
      tenantId: b.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'ACTIVA',
      nombre: canarios.nombrePersonalB,
    });
    for (const [e, cliente, motivo] of [
      [a, clienteA, canarios.motivoBloqueoA],
      [b, clienteB, canarios.motivoBloqueoB],
    ] as const) {
      await sembrarBloqueo({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        inicio: new Date(horaLima(fecha, '09:00')),
        fin: new Date(horaLima(fecha, '10:00')),
        motivo,
      });
      await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId: e.barberoId,
        servicioId: e.servicioId,
        clienteId: cliente.clienteId,
        inicio: new Date(horaLima(fecha, '11:00')),
      });
    }
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('1. Permisos exactos del rol barberias_publico', () => {
    it('solo SELECT sobre las columnas de la lista cerrada de ADR-021, sin permisos de tabla ni sobre tenant', async () => {
      const seed = poolDe('seed');
      const columnas = await seed.query<{ tabla: string; columna: string; privilegio: string }>(
        `SELECT table_name AS tabla, column_name AS columna, privilege_type AS privilegio
           FROM information_schema.column_privileges
          WHERE grantee = 'barberias_publico' AND table_schema = 'public'`,
      );
      expect(new Set(columnas.rows.map((f) => f.privilegio))).toEqual(new Set(['SELECT']));
      const otorgadas = columnas.rows.map((f) => `${f.tabla}.${f.columna}`).sort();
      const esperadas = Object.entries(COLUMNAS_PUBLICAS)
        .flatMap(([tabla, cols]) => cols.map((c) => `${tabla}.${c}`))
        .sort();
      expect(otorgadas).toEqual(esperadas);
      expect(otorgadas.some((c) => c.startsWith('tenant.'))).toBe(false);

      const tablas = await seed.query(
        `SELECT table_name, privilege_type FROM information_schema.table_privileges
          WHERE grantee = 'barberias_publico' AND table_schema = 'public'`,
      );
      expect(tablas.rows).toEqual([]);
    });
  });

  describe('2. Rol sin privilegios extra', () => {
    it('NOBYPASSRLS, no es dueño de nada y no puede ejecutar las funciones de ADR-015', async () => {
      const seed = poolDe('seed');
      const rol = await seed.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
        "SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'barberias_publico'",
      );
      expect(rol.rows).toEqual([{ rolbypassrls: false, rolsuper: false }]);

      const propios = await seed.query(
        `SELECT c.relname FROM pg_class c JOIN pg_roles r ON r.oid = c.relowner
          WHERE r.rolname = 'barberias_publico'
         UNION ALL
         SELECT p.proname FROM pg_proc p JOIN pg_roles r ON r.oid = p.proowner
          WHERE r.rolname = 'barberias_publico'`,
      );
      expect(propios.rows).toEqual([]);

      const funciones = await seed.query<{ proname: string; ejecuta: boolean }>(
        `SELECT p.proname, has_function_privilege('barberias_publico', p.oid, 'EXECUTE') AS ejecuta
           FROM pg_proc p
          WHERE p.proname IN ('auth_resolver_cuenta', 'auth_buscar_sesion', 'auth_buscar_activacion')
          ORDER BY p.proname`,
      );
      expect(funciones.rows).toEqual([
        { proname: 'auth_buscar_activacion', ejecuta: false },
        { proname: 'auth_buscar_sesion', ejecuta: false },
        { proname: 'auth_resolver_cuenta', ejecuta: false },
      ]);
      await expect(
        comoPublico(null, (c) => c.query("SELECT * FROM auth_resolver_cuenta('x@prueba.pe')")),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('3. Las columnas privadas fallan en PostgreSQL', () => {
    it.each([
      ['SELECT customer_id FROM appointment'],
      ['SELECT reason FROM time_off'],
      ['SELECT user_id FROM barber'],
      ['SELECT * FROM appointment'],
      ['SELECT email FROM customer_profile'],
      ['SELECT slug FROM tenant'],
      ['SELECT email FROM user_account'],
    ])('%s → permiso denegado', async (consulta) => {
      await expect(comoPublico(a.barberia.tenantId, (c) => c.query(consulta))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('4. RLS: filas de otro tenant', () => {
    it.each(TABLAS_PUBLICAS)('%s: con el tenant de A no aparece ninguna fila de B', async (tabla) => {
      const filas = await comoPublico(a.barberia.tenantId, async (c) => {
        const { rows } = await c.query<{ tenant_id: string }>(`SELECT tenant_id FROM ${tabla}`);
        return rows;
      });
      expect(filas.length).toBeGreaterThan(0);
      expect(filas.every((f) => f.tenant_id === a.barberia.tenantId)).toBe(true);
    });

    it.each(TABLAS_PUBLICAS)('%s: sin tenant no aparece ninguna fila', async (tabla) => {
      const { rows } = await comoPublico(null, (c) => c.query(`SELECT tenant_id FROM ${tabla}`));
      expect(rows).toEqual([]);
    });
  });

  describe('5. Escritura imposible', () => {
    it.each([
      [`UPDATE service SET name = 'x'`],
      [`DELETE FROM appointment`],
      [
        `INSERT INTO time_off (id, tenant_id, barber_id, starts_at, ends_at, created_by)
        VALUES (gen_random_uuid(), current_setting('app.tenant_id')::uuid, gen_random_uuid(), now(), now() + interval '1 hour', gen_random_uuid())`,
      ],
    ])('%s → permiso denegado', async (sentencia) => {
      await expect(comoPublico(a.barberia.tenantId, (c) => c.query(sentencia))).rejects.toThrow(
        /permission denied/,
      );
    });
  });

  describe('6. HTTP: datos canario y respuesta única ante enlaces no disponibles', () => {
    const rutasDe = (e: BarberiaParaReservar) => [
      `/api/v1/publico/${e.barberia.slug}`,
      `/api/v1/publico/${e.barberia.slug}/horarios?servicio=${e.servicioId}&fecha=${fecha}`,
      `/api/v1/publico/${e.barberia.slug}/horarios?servicio=${e.servicioId}&fecha=${fecha}&barbero=${e.barberoId}`,
    ];

    it('ninguna respuesta de /publico/* contiene correos, teléfonos, nombres de clientes o del personal ni motivos de bloqueo', async () => {
      for (const ruta of [...rutasDe(a), ...rutasDe(b)]) {
        const { body } = await prueba.agente.get(ruta).expect(200);
        const texto = JSON.stringify(body);
        for (const canario of Object.values(canarios)) expect(texto).not.toContain(canario);
        expect(texto).not.toMatch(/@prueba\.pe/);
      }
    });

    it('la vía pública sí ve la ocupación: el bloqueo y la cita sembrados no se ofrecen', async () => {
      const { body } = await prueba.agente.get(rutasDe(a)[2]).expect(200);
      const inicios: string[] = body.horas.map((hora: { inicio: string }) => hora.inicio);
      expect(inicios).not.toContain(horaLima(fecha, '09:00'));
      expect(inicios).not.toContain(horaLima(fecha, '11:00'));
      expect(inicios).toContain(horaLima(fecha, '10:00'));
      expect(inicios).toContain(horaLima(fecha, '11:30'));
    });

    it('un slug inexistente, uno cambiado y uno suspendido dan la misma respuesta 404', async () => {
      const cambiada = await barberiaParaReservar();
      const slugAnterior = cambiada.barberia.slug;
      await poolDe('seed').query('UPDATE tenant SET slug = $1 WHERE id = $2', [
        `${slugAnterior}-nuevo`,
        cambiada.barberia.tenantId,
      ]);
      const suspendida = await barberiaParaReservar();
      await poolDe('seed').query("UPDATE tenant SET status = 'SUSPENDIDA' WHERE id = $1", [
        suspendida.barberia.tenantId,
      ]);

      for (const sufijoRuta of ['', `/horarios?servicio=${a.servicioId}&fecha=${fecha}`]) {
        const respuestas = await Promise.all(
          ['no-existe-esta-barberia', slugAnterior, suspendida.barberia.slug].map((slug) =>
            prueba.agente.get(`/api/v1/publico/${slug}${sufijoRuta}`),
          ),
        );
        for (const r of respuestas) {
          expect(r.status).toBe(404);
          expect(r.body).toEqual(respuestas[0].body);
        }
        expect(respuestas[0].body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
      }
      // El enlace nuevo sí funciona.
      await prueba.agente.get(`/api/v1/publico/${slugAnterior}-nuevo`).expect(200);
    });

    it.each(['post', 'put', 'patch', 'delete'] as const)(
      '%s sobre /publico/* se rechaza y no escribe nada',
      async (metodo) => {
        const antes = await poolDe('seed').query(
          'SELECT count(*)::int AS n FROM service WHERE tenant_id = $1',
          [a.barberia.tenantId],
        );
        for (const ruta of rutasDe(a).slice(0, 2)) {
          const respuesta = await prueba.agente[metodo](ruta).send({ nombre: 'x' });
          expect(respuesta.status).toBeGreaterThanOrEqual(400);
          expect(respuesta.status).toBeLessThan(500);
        }
        const despues = await poolDe('seed').query(
          'SELECT count(*)::int AS n FROM service WHERE tenant_id = $1',
          [a.barberia.tenantId],
        );
        expect(despues.rows[0].n).toBe(antes.rows[0].n);
      },
    );

    it('un token de B enviado a /publico/{slug-de-A} no cambia la respuesta', async () => {
      const tokenB = await tokenPara(b.barberia.tenantId, b.barberia.propietarioId, 'PROPIETARIO');
      for (const ruta of rutasDe(a)) {
        const sin = await prueba.agente.get(ruta).expect(200);
        const con = await prueba.agente
          .get(ruta)
          .set({ Authorization: `Bearer ${tokenB}` })
          .expect(200);
        // calculadoEn es el instante de cada cálculo: lo único que puede variar.
        expect({ ...con.body, calculadoEn: null }).toEqual({ ...sin.body, calculadoEn: null });
      }
    });
  });
});
