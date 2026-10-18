/**
 * T133 · Medición preliminar de horarios libres (evidencia previa a la prueba de carga de 006 para SC-004 y
 * EQ-01; no la sustituye). Fuera de CI y sin dependencias nuevas: `npm run medir:horarios`.
 *
 * 1. Siembra con el superusuario de desarrollo una barbería activa con 5 barberos que ofrecen un servicio de
 *    30 minutos y 60 citas confirmadas en el día medido.
 * 2. Lanza 10 rondas de 50 consultas simultáneas a `GET /api/v1/publico/{slug}/horarios` contra el backend que
 *    ya está corriendo (una instancia).
 * 3. Informa p50, p95, máximo y errores, y borra lo sembrado.
 *
 * Variables (todas opcionales):
 * - `MEDIR_API` (por defecto `http://localhost:3000/api/v1`);
 * - `MEDIR_DB_SUPERUSUARIO` (por defecto la base de Docker Compose: `postgres://postgres:postgres_dev@localhost:5433/barberias`);
 * - `MEDIR_RONDAS` (10) y `MEDIR_CONCURRENCIA` (50).
 *
 * El backend medido debe arrancar con `PUBLICO_LIMITE_POR_MINUTO` alto (por ejemplo 100000): con el límite
 * de producción (120 por IP y minuto) casi todas las consultas de una sola IP recibirían 429.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Pool } from 'pg';

const API = process.env.MEDIR_API ?? 'http://localhost:3000/api/v1';
const DB = process.env.MEDIR_DB_SUPERUSUARIO ?? 'postgres://postgres:postgres_dev@localhost:5433/barberias';
const RONDAS = Number(process.env.MEDIR_RONDAS ?? 10);
const CONCURRENCIA = Number(process.env.MEDIR_CONCURRENCIA ?? 50);
const BARBEROS = 5;
const CITAS = 60;

/** Fecha de Lima (YYYY-MM-DD) dentro de `dias` días. */
function fechaLima(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
    new Date(Date.now() + dias * 86_400_000),
  );
}

function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return Number.NaN;
  const indice = Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1);
  return ordenados[Math.max(0, indice)];
}

interface Sembrado {
  tenantId: string;
  slug: string;
  servicioId: string;
  fecha: string;
}

async function sembrar(db: Pool): Promise<Sembrado> {
  const tenantId = randomUUID();
  const slug = `medicion-${tenantId.slice(0, 8)}`;
  const servicioId = randomUUID();
  const fecha = fechaLima(3);
  const creadoPor = randomUUID();
  await db.query(
    "INSERT INTO tenant (id, name, slug, status) VALUES ($1, 'Barbería de medición', $2, 'ACTIVA')",
    [tenantId, slug],
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
  for (let i = 0; i < BARBEROS; i += 1) {
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
  // 60 citas confirmadas en el día medido: 12 por barbero, de 09:00 a 15:00, cada una con su cliente presencial.
  for (let i = 0; i < CITAS; i += 1) {
    const barberoId = barberos[i % BARBEROS];
    const minutos = 9 * 60 + Math.floor(i / BARBEROS) * 30;
    const hora = `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
    const inicio = new Date(`${fecha}T${hora}:00-05:00`);
    const clienteId = randomUUID();
    await db.query(
      `INSERT INTO customer_profile (id, tenant_id, full_name, phone, origin, created_by)
       VALUES ($1, $2, $3, '966000000', 'PRESENCIAL', $4)`,
      [clienteId, tenantId, `Cliente ${i + 1}`, creadoPor],
    );
    await db.query(
      `INSERT INTO appointment (id, tenant_id, barber_id, service_id, customer_id, service_name, price, duration_min,
                                starts_at, ends_at, status, origin, created_by)
       VALUES ($1, $2, $3, $4, $5, 'Corte', '20.00', 30, $6, $7, 'CONFIRMADA', 'PRESENCIAL', $8)`,
      [
        randomUUID(),
        tenantId,
        barberoId,
        servicioId,
        clienteId,
        inicio,
        new Date(inicio.getTime() + 30 * 60_000),
        creadoPor,
      ],
    );
  }
  return { tenantId, slug, servicioId, fecha };
}

async function limpiar(db: Pool, tenantId: string): Promise<void> {
  for (const tabla of [
    'appointment',
    'customer_profile',
    'working_hours',
    'barber_service',
    'barber',
    'service',
    'business_hours',
  ]) {
    await db.query(`DELETE FROM ${tabla} WHERE tenant_id = $1`, [tenantId]);
  }
  await db.query('DELETE FROM tenant WHERE id = $1', [tenantId]);
}

async function medir(sembrado: Sembrado) {
  const url = `${API}/publico/${sembrado.slug}/horarios?servicio=${sembrado.servicioId}&fecha=${sembrado.fecha}`;
  // Calentamiento: conexiones del pool y planes de consulta.
  const calentamiento = await fetch(url);
  if (calentamiento.status !== 200) {
    throw new Error(
      `La consulta de calentamiento respondió ${calentamiento.status}: ${await calentamiento.text()}`,
    );
  }
  const tiempos: number[] = [];
  const estados = new Map<number, number>();
  let errores = 0;
  for (let ronda = 0; ronda < RONDAS; ronda += 1) {
    await Promise.all(
      Array.from({ length: CONCURRENCIA }, async () => {
        const inicio = performance.now();
        try {
          const respuesta = await fetch(url);
          await respuesta.arrayBuffer();
          tiempos.push(performance.now() - inicio);
          estados.set(respuesta.status, (estados.get(respuesta.status) ?? 0) + 1);
        } catch {
          errores += 1;
        }
      }),
    );
  }
  tiempos.sort((a, b) => a - b);
  const total = RONDAS * CONCURRENCIA;
  const cincoXX = [...estados].filter(([estado]) => estado >= 500).reduce((suma, [, n]) => suma + n, 0);
  return {
    consultas: total,
    rondas: RONDAS,
    concurrencia: CONCURRENCIA,
    p50_ms: Math.round(percentil(tiempos, 50)),
    p95_ms: Math.round(percentil(tiempos, 95)),
    max_ms: Math.round(tiempos.at(-1) ?? Number.NaN),
    estados: Object.fromEntries(estados),
    errores_de_red: errores,
    porcentaje_5xx: Number(((100 * cincoXX) / total).toFixed(2)),
  };
}

async function principal(): Promise<void> {
  const db = new Pool({ connectionString: DB, max: 2 });
  let sembrado: Sembrado | null = null;
  try {
    sembrado = await sembrar(db);
    console.log(
      `Barbería sembrada: ${sembrado.slug} (${BARBEROS} barberos, ${CITAS} citas el ${sembrado.fecha}).`,
    );
    const resultado = await medir(sembrado);
    console.log(JSON.stringify(resultado, null, 2));
    const cumple = resultado.p95_ms <= 800 && resultado.porcentaje_5xx === 0;
    console.log(`Meta de referencia (p95 ≤ 800 ms y 0 % de 5xx): ${cumple ? 'se cumple' : 'NO se cumple'}.`);
    if ((resultado.estados[429] ?? 0) > 0) {
      console.log('Aviso: hubo respuestas 429. Arranca el backend con PUBLICO_LIMITE_POR_MINUTO alto.');
    }
  } finally {
    if (sembrado) await limpiar(db, sembrado.tenantId);
    await db.end();
  }
}

principal().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
