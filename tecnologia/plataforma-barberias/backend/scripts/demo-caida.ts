/**
 * T047 (006, R13) · Demostración de caída con el entorno real de Docker Compose (Nginx, dos réplicas, Redis y
 * PostgreSQL). Fuera de CI y sin dependencias nuevas: `npm run demo:caida -- --objetivo replica|redis`.
 *
 * 1. Siembra con el superusuario de desarrollo una barbería de prueba (como `medir-horarios.ts`).
 * 2. Genera tráfico continuo (unas 20 solicitudes por segundo, catálogo y horarios) por Nginx.
 * 3. A los `--parada` segundos detiene `backend-2` o `redis` y a los `--arranque` lo vuelve a iniciar, con
 *    `docker compose` desde `tecnologia/plataforma-barberias/` (`--manual`: solo indica cuándo hacerlo).
 * 4. Informa por segundo las solicitudes, los errores y el reparto por `X-Instancia`, y al final: cuánto tardó
 *    `backend-2` en dejar de aparecer, el porcentaje de errores en la transición, la reincorporación y el p95
 *    durante la caída. Con `redis`, además hace 20 reservas durante la caída (cada una enviada dos veces con la
 *    misma Idempotency-Key) y comprueba en la base que no hay duplicados.
 * 5. Guarda el resumen en JSON (`--salida`, por defecto en `tmp/` del repositorio) y borra lo sembrado.
 *
 * Opciones: `--objetivo replica|redis` (replica), `--url` (http://localhost:3000/api/v1), `--duracion` (60),
 * `--parada` (15), `--arranque` (40), `--salida`, `--manual`. Variable `MEDIR_DB_SUPERUSUARIO` como en
 * `medir-horarios.ts`.
 *
 * Las réplicas deben arrancar con `PUBLICO_LIMITE_POR_MINUTO` alto (p. ej. 100000): con 120 por IP y minuto,
 * el tráfico de una sola IP recibiría 429. Las réplicas se reinician con `--no-deps` (entorno-compose.md §4).
 */
import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import argon2 from 'argon2';
import { Pool } from 'pg';

const { values: opciones } = parseArgs({
  options: {
    objetivo: { type: 'string', default: 'replica' },
    url: { type: 'string', default: 'http://localhost:3000/api/v1' },
    duracion: { type: 'string', default: '60' },
    parada: { type: 'string', default: '15' },
    arranque: { type: 'string', default: '40' },
    salida: { type: 'string' },
    manual: { type: 'boolean', default: false },
  },
});

const OBJETIVO = opciones.objetivo === 'redis' ? 'redis' : 'replica';
const SERVICIO = OBJETIVO === 'redis' ? 'redis' : 'backend-2';
const API = opciones.url as string;
const DURACION_S = Number(opciones.duracion);
const PARADA_S = Number(opciones.parada);
const ARRANQUE_S = Number(opciones.arranque);
const DB = process.env.MEDIR_DB_SUPERUSUARIO ?? 'postgres://postgres:postgres_dev@localhost:5433/barberias';
const RAIZ_COMPOSE = resolve(__dirname, '..', '..');
const SALIDA =
  opciones.salida ?? resolve(__dirname, '..', '..', '..', '..', 'tmp', `demo-caida-${OBJETIVO}.json`);
const POR_SEGUNDO = 20;
const RESERVAS = 20;
/** Ventana tras la parada en la que se mide el porcentaje de errores de la transición. */
const TRANSICION_S = 10;
const CONTRASENA = `demo-${randomUUID()}`;

if (!(PARADA_S < ARRANQUE_S && ARRANQUE_S < DURACION_S)) {
  throw new Error('Debe cumplirse parada < arranque < duracion');
}

/** Fecha de Lima (YYYY-MM-DD) dentro de `dias` días. */
function fechaLima(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
    new Date(Date.now() + dias * 86_400_000),
  );
}

function percentil(ordenados: number[], p: number): number | null {
  if (ordenados.length === 0) return null;
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return Math.round(ordenados[Math.max(0, indice)]);
}

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

interface Sembrado {
  tenantId: string;
  slug: string;
  servicioId: string;
  barberos: string[];
  clienteId: string;
  correo: string;
  fecha: string;
}

async function sembrar(db: Pool): Promise<Sembrado> {
  const tenantId = randomUUID();
  const slug = `demo-caida-${tenantId.slice(0, 8)}`;
  const servicioId = randomUUID();
  const fecha = fechaLima(3);
  const correo = `${slug}@demo.local`;
  await db.query(
    "INSERT INTO tenant (id, name, slug, status) VALUES ($1, 'Barbería de demostración', $2, 'ACTIVA')",
    [tenantId, slug],
  );
  await db.query(
    `INSERT INTO subscription (id, tenant_id, plan_id, status, started_at, trial_ends_at)
     SELECT $1, $2, p.id, 'TRIAL', now(), now() + interval '14 days' FROM plan p WHERE p.code = 'TRIAL'`,
    [randomUUID(), tenantId],
  );
  const propietarioId = randomUUID();
  await db.query('INSERT INTO user_account (id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)', [
    propietarioId,
    correo,
    'Propietario de demostración',
    await argon2.hash(CONTRASENA, { type: argon2.argon2id }),
  ]);
  await db.query(
    "INSERT INTO membership (id, tenant_id, user_id, role_code, status) VALUES ($1, $2, $3, 'PROPIETARIO', 'ACTIVA')",
    [randomUUID(), tenantId, propietarioId],
  );
  for (let dia = 0; dia < 7; dia += 1) {
    await db.query(
      "INSERT INTO business_hours (id, tenant_id, weekday, start_time, end_time) VALUES ($1, $2, $3, '09:00', '19:00')",
      [randomUUID(), tenantId, dia],
    );
  }
  await db.query(
    "INSERT INTO service (id, tenant_id, name, price, duration_min) VALUES ($1, $2, 'Corte', '20.00', 30)",
    [servicioId, tenantId],
  );
  const barberos: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const barberoId = randomUUID();
    barberos.push(barberoId);
    await db.query('INSERT INTO barber (id, tenant_id, display_name) VALUES ($1, $2, $3)', [
      barberoId,
      tenantId,
      `Barbero ${i + 1}`,
    ]);
    await db.query('INSERT INTO barber_service (tenant_id, barber_id, service_id) VALUES ($1, $2, $3)', [
      tenantId,
      barberoId,
      servicioId,
    ]);
    for (let dia = 0; dia < 7; dia += 1) {
      await db.query(
        `INSERT INTO working_hours (id, tenant_id, barber_id, weekday, start_time, end_time)
         VALUES ($1, $2, $3, $4, '09:00', '19:00')`,
        [randomUUID(), tenantId, barberoId, dia],
      );
    }
  }
  const clienteId = randomUUID();
  await db.query(
    `INSERT INTO customer_profile (id, tenant_id, full_name, phone, origin, created_by)
     VALUES ($1, $2, 'Cliente de demostración', '966000000', 'PRESENCIAL', $3)`,
    [clienteId, tenantId, propietarioId],
  );
  return { tenantId, slug, servicioId, barberos, clienteId, correo, fecha };
}

/** Borra todo lo de la barbería sembrada: tablas con `tenant_id` (reintenta por las claves foráneas). */
async function limpiar(db: Pool, sembrado: Sembrado): Promise<void> {
  const { rows } = await db.query<{ tabla: string }>(
    `SELECT table_name AS tabla FROM information_schema.columns
      WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenant'`,
  );
  let pendientes = rows.map((f) => f.tabla);
  for (let pasada = 0; pasada < 5 && pendientes.length > 0; pasada += 1) {
    const fallidas: string[] = [];
    for (const tabla of pendientes) {
      try {
        await db.query(`DELETE FROM "${tabla}" WHERE tenant_id = $1`, [sembrado.tenantId]);
      } catch {
        fallidas.push(tabla);
      }
    }
    pendientes = fallidas;
  }
  await db.query('DELETE FROM tenant WHERE id = $1', [sembrado.tenantId]);
  await db.query('DELETE FROM user_account WHERE email = $1', [sembrado.correo]);
}

function compose(accion: 'detener' | 'iniciar'): Promise<void> {
  const comando =
    accion === 'detener' ? `docker compose stop ${SERVICIO}` : `docker compose up -d --no-deps ${SERVICIO}`;
  if (opciones.manual) {
    console.log(`>>> AHORA, en tecnologia/plataforma-barberias/: ${comando}`);
    return Promise.resolve();
  }
  console.log(`>>> ${comando}`);
  // Asíncrono: el tráfico sigue mientras Docker detiene o inicia el contenedor.
  return new Promise((resolver) => {
    exec(comando, { cwd: RAIZ_COMPOSE }, (error, _salida, errores) => {
      if (error) console.error(`docker compose falló: ${errores || error.message}`);
      resolver();
    });
  });
}

interface Muestra {
  t: number;
  ms: number;
  estado: number;
  instancia: string | null;
}

async function solicitar(url: string, inicio: number, muestras: Muestra[]): Promise<void> {
  const antes = performance.now();
  try {
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    await respuesta.arrayBuffer();
    muestras.push({
      t: (antes - inicio) / 1000,
      ms: performance.now() - antes,
      estado: respuesta.status,
      instancia: respuesta.headers.get('x-instancia'),
    });
  } catch {
    muestras.push({ t: (antes - inicio) / 1000, ms: performance.now() - antes, estado: 0, instancia: null });
  }
}

async function iniciarSesion(correo: string): Promise<string> {
  const respuesta = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ correo, contrasena: CONTRASENA }),
  });
  if (respuesta.status !== 200)
    throw new Error(`Inicio de sesión: ${respuesta.status} ${await respuesta.text()}`);
  return ((await respuesta.json()) as { tokenAcceso: string }).tokenAcceso;
}

/** 20 reservas presenciales del propietario, cada una enviada dos veces con la misma clave. */
async function reservar(sembrado: Sembrado, token: string, db: Pool) {
  const resultados: { hora: string; estados: number[]; mismoId: boolean }[] = [];
  for (let i = 0; i < RESERVAS; i += 1) {
    // Un horario distinto por reserva (09:00 a 18:30): el mismo cliente no puede tener dos citas a la vez.
    const minutos = 9 * 60 + i * 30;
    const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    const clave = randomUUID();
    const enviar = () =>
      fetch(`${API}/citas`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
          'idempotency-key': clave,
        },
        body: JSON.stringify({
          servicioId: sembrado.servicioId,
          barberoId: sembrado.barberos[i % 2],
          inicio: `${sembrado.fecha}T${hora}:00-05:00`,
          clienteId: sembrado.clienteId,
        }),
      });
    const primera = await enviar();
    const segunda = await enviar();
    const [a, b] = [(await primera.json()) as { id?: string }, (await segunda.json()) as { id?: string }];
    resultados.push({ hora, estados: [primera.status, segunda.status], mismoId: !!a.id && a.id === b.id });
  }
  const { rows } = await db.query<{ citas: number; solapadas: number }>(
    `SELECT count(*)::int AS citas,
            (SELECT count(*)::int FROM appointment x JOIN appointment y
               ON x.tenant_id = y.tenant_id AND x.barber_id = y.barber_id AND x.id < y.id
              AND x.status IN ('PENDIENTE', 'CONFIRMADA') AND y.status IN ('PENDIENTE', 'CONFIRMADA')
              AND tstzrange(x.starts_at, x.ends_at) && tstzrange(y.starts_at, y.ends_at)
             WHERE x.tenant_id = $1) AS solapadas
       FROM appointment WHERE tenant_id = $1`,
    [sembrado.tenantId],
  );
  return {
    enviadas: RESERVAS * 2,
    aceptadas: resultados.filter((r) => r.estados[0] === 201).length,
    reintentos_con_mismo_id: resultados.filter((r) => r.mismoId).length,
    estados: resultados
      .flatMap((r) => r.estados)
      .reduce<Record<number, number>>((cuenta, estado) => {
        cuenta[estado] = (cuenta[estado] ?? 0) + 1;
        return cuenta;
      }, {}),
    citas_en_la_base: rows[0].citas,
    citas_solapadas: rows[0].solapadas,
    sin_duplicados: rows[0].citas === RESERVAS && rows[0].solapadas === 0,
  };
}

function resumir(muestras: Muestra[], paradaReal: number | null, arranqueReal: number | null) {
  const porSegundo = new Map<number, Muestra[]>();
  for (const m of muestras) {
    const s = Math.floor(m.t);
    porSegundo.set(s, [...(porSegundo.get(s) ?? []), m]);
  }
  const esError = (m: Muestra) => m.estado === 0 || m.estado >= 500;
  const segundos = [...porSegundo.keys()]
    .sort((a, b) => a - b)
    .map((s) => {
      const lista = porSegundo.get(s) ?? [];
      const reparto: Record<string, number> = {};
      for (const m of lista) reparto[m.instancia ?? 'ninguna'] = (reparto[m.instancia ?? 'ninguna'] ?? 0) + 1;
      return { segundo: s, solicitudes: lista.length, errores: lista.filter(esError).length, reparto };
    });

  const parada = paradaReal ?? PARADA_S;
  const arranque = arranqueReal ?? ARRANQUE_S;
  const deBackend2 = muestras.filter((m) => m.instancia === 'backend-2');
  const ultimaAntes = deBackend2.filter((m) => m.t >= parada && m.t < arranque).at(-1);
  const primeraDespues = deBackend2.find((m) => m.t >= arranque);
  const transicion = muestras.filter((m) => m.t >= parada && m.t < parada + TRANSICION_S);
  const durante = muestras
    .filter((m) => m.t >= parada && m.t < arranque && !esError(m))
    .map((m) => m.ms)
    .sort((a, b) => a - b);
  const todas = muestras.map((m) => m.ms).sort((a, b) => a - b);
  const total = muestras.length;
  return {
    objetivo: OBJETIVO,
    servicio: SERVICIO,
    duracion_s: DURACION_S,
    parada_s: Number(parada.toFixed(1)),
    arranque_s: Number(arranque.toFixed(1)),
    solicitudes: total,
    errores: muestras.filter(esError).length,
    porcentaje_errores: Number(((100 * muestras.filter(esError).length) / Math.max(1, total)).toFixed(2)),
    respuestas_429: muestras.filter((m) => m.estado === 429).length,
    transicion: {
      ventana_s: TRANSICION_S,
      solicitudes: transicion.length,
      errores: transicion.filter(esError).length,
      porcentaje_errores: Number(
        ((100 * transicion.filter(esError).length) / Math.max(1, transicion.length)).toFixed(2),
      ),
    },
    backend2_deja_de_aparecer_s:
      OBJETIVO === 'replica' ? Number(((ultimaAntes?.t ?? parada) - parada).toFixed(1)) : null,
    reincorporacion_s:
      OBJETIVO === 'replica' && primeraDespues ? Number((primeraDespues.t - arranque).toFixed(1)) : null,
    p95_durante_caida_ms: percentil(durante, 95),
    p95_total_ms: percentil(todas, 95),
    por_segundo: segundos,
  };
}

async function principal(): Promise<void> {
  const db = new Pool({ connectionString: DB, max: 2 });
  let sembrado: Sembrado | null = null;
  try {
    sembrado = await sembrar(db);
    const token = OBJETIVO === 'redis' ? await iniciarSesion(sembrado.correo) : null;
    const urls = [
      `${API}/publico/${sembrado.slug}`,
      `${API}/publico/${sembrado.slug}/horarios?servicio=${sembrado.servicioId}&fecha=${sembrado.fecha}`,
    ];
    console.log(
      `Barbería sembrada: ${sembrado.slug}. Objetivo: ${SERVICIO}; parada a los ${PARADA_S} s, arranque a los ` +
        `${ARRANQUE_S} s, ${DURACION_S} s en total.`,
    );

    const muestras: Muestra[] = [];
    const enVuelo = new Set<Promise<void>>();
    const inicio = performance.now();
    const ahora = () => (performance.now() - inicio) / 1000;
    let paradaReal: number | null = null;
    let arranqueReal: number | null = null;
    let reservas: Awaited<ReturnType<typeof reservar>> | null = null;
    const tareas: Promise<unknown>[] = [];
    let ultimoInforme = 0;

    for (let n = 0; ahora() < DURACION_S; n += 1) {
      const t = ahora();
      if (paradaReal === null && t >= PARADA_S) {
        paradaReal = t;
        tareas.push(compose('detener'));
        if (OBJETIVO === 'redis' && token) {
          // Las reservas empiezan cuando Redis ya no responde.
          tareas.push(
            esperar(3_000)
              .then(() => reservar(sembrado as Sembrado, token, db))
              .then((r) => (reservas = r)),
          );
        }
      }
      if (arranqueReal === null && t >= ARRANQUE_S) {
        arranqueReal = t;
        tareas.push(compose('iniciar'));
      }
      const solicitud = solicitar(urls[n % 2], inicio, muestras);
      enVuelo.add(solicitud);
      void solicitud.finally(() => enVuelo.delete(solicitud));
      if (Math.floor(t) > ultimoInforme) {
        ultimoInforme = Math.floor(t);
        const previas = muestras.filter((m) => Math.floor(m.t) === ultimoInforme - 1);
        const reparto: Record<string, number> = {};
        for (const m of previas)
          reparto[m.instancia ?? 'ninguna'] = (reparto[m.instancia ?? 'ninguna'] ?? 0) + 1;
        const errores = previas.filter((m) => m.estado === 0 || m.estado >= 500).length;
        console.log(
          `t=${ultimoInforme - 1}s solicitudes=${previas.length} errores=${errores} ${JSON.stringify(reparto)}`,
        );
      }
      await esperar(1000 / POR_SEGUNDO);
    }
    await Promise.all([...enVuelo, ...tareas]);

    const resumen = { ...resumir(muestras, paradaReal, arranqueReal), reservas_durante_caida: reservas };
    // En consola, sin el detalle por segundo (ya se informó durante el tráfico; queda en el JSON).
    console.log(JSON.stringify({ ...resumen, por_segundo: undefined }, null, 2));
    if (resumen.respuestas_429 > 0) {
      console.log('Aviso: hubo respuestas 429. Arranca las réplicas con PUBLICO_LIMITE_POR_MINUTO alto.');
    }
    mkdirSync(dirname(SALIDA), { recursive: true });
    writeFileSync(SALIDA, JSON.stringify(resumen, null, 2));
    console.log(`Resumen completo en ${SALIDA}`);
  } finally {
    if (sembrado) await limpiar(db, sembrado);
    await db.end();
  }
}

principal().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
