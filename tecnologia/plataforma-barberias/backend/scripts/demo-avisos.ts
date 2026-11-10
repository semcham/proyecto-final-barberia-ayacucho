/**
 * T074 (004, fase 3) · Demostración de los avisos de cita con el entorno real de Docker Compose (Nginx, dos
 * réplicas, PostgreSQL y Mailpit). Fuera de CI y sin dependencias nuevas: `npm run demo:avisos`, desde
 * `tecnologia/plataforma-barberias/backend/`, con `docker compose up -d` ya en marcha.
 *
 * Recorrido por defecto (quickstart, pasos 1 a 3):
 *  1. Siembra con el superusuario de desarrollo una barbería y un cliente con correo; el propietario registra una
 *     cita → en Mailpit, UN correo de confirmación en texto simple, sin el teléfono del cliente.
 *  2. `docker compose stop mailpit`; el propietario reprograma la cita → 200, sin esperar al correo (se mide).
 *  3. `docker compose start mailpit` → al volver (pausa del circuito, 30 s, más el intervalo de la tarea), UN
 *     correo de reprogramación con la hora anterior y la nueva; ninguno repetido.
 *
 * Con `--caida` (quickstart, paso 16): registra una cita y detiene `backend-1` justo después; la confirmación
 * llega igual, una vez, enviada por `backend-2`. Al final vuelve a levantar `backend-1` (`--no-deps`).
 *
 * Opciones: `--url` (http://localhost:3000/api/v1), `--mailpit` (http://localhost:8025/api/v1), `--espera` (s
 * máximos para cada correo, 120), `--salida` (JSON, por defecto en `tmp/` del repositorio), `--manual` (solo
 * indica los comandos de Docker). Variable `MEDIR_DB_SUPERUSUARIO` como en `demo-caida.ts`.
 *
 * Línea de corte (recorte 2): sin `--recordatorio` (fase 4) ni WhatsApp (fase 5).
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
    url: { type: 'string', default: 'http://localhost:3000/api/v1' },
    mailpit: { type: 'string', default: 'http://localhost:8025/api/v1' },
    espera: { type: 'string', default: '120' },
    salida: { type: 'string' },
    caida: { type: 'boolean', default: false },
    manual: { type: 'boolean', default: false },
  },
});

const API = opciones.url as string;
const MAILPIT = opciones.mailpit as string;
const ESPERA_MS = Number(opciones.espera) * 1000;
const DB = process.env.MEDIR_DB_SUPERUSUARIO ?? 'postgres://postgres:postgres_dev@localhost:5433/barberias';
const RAIZ_COMPOSE = resolve(__dirname, '..', '..');
const RECORRIDO = opciones.caida ? 'caida' : 'correo-caido';
const SALIDA =
  opciones.salida ?? resolve(__dirname, '..', '..', '..', '..', 'tmp', `demo-avisos-${RECORRIDO}.json`);
const CONTRASENA = `demo-${randomUUID()}`;
const TELEFONO = '966000123';

const esperar = (ms: number) => new Promise((resolver) => setTimeout(resolver, ms));

function fechaLima(dias: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(
    new Date(Date.now() + dias * 86_400_000),
  );
}

interface Sembrado {
  tenantId: string;
  servicioId: string;
  barberoId: string;
  clienteId: string;
  correoPropietario: string;
  correoCliente: string;
  fecha: string;
}

async function sembrar(db: Pool): Promise<Sembrado> {
  const tenantId = randomUUID();
  const slug = `demo-avisos-${tenantId.slice(0, 8)}`;
  const servicioId = randomUUID();
  const barberoId = randomUUID();
  const correoPropietario = `${slug}@demo.local`;
  const correoCliente = `cliente-${slug}@demo.local`;
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
    correoPropietario,
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
  await db.query("INSERT INTO barber (id, tenant_id, display_name) VALUES ($1, $2, 'Luis')", [
    barberoId,
    tenantId,
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
  // Cliente presencial CON correo: recibe los avisos (FR-015).
  const clienteId = randomUUID();
  await db.query(
    `INSERT INTO customer_profile (id, tenant_id, full_name, email, phone, origin, created_by)
     VALUES ($1, $2, 'Cliente de demostración', $3, $4, 'PRESENCIAL', $5)`,
    [clienteId, tenantId, correoCliente, TELEFONO, propietarioId],
  );
  return {
    tenantId,
    servicioId,
    barberoId,
    clienteId,
    correoPropietario,
    correoCliente,
    fecha: fechaLima(3),
  };
}

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
  await db.query('DELETE FROM user_account WHERE email = $1', [sembrado.correoPropietario]);
}

function compose(comando: string): Promise<void> {
  if (opciones.manual) {
    console.log(`>>> AHORA, en tecnologia/plataforma-barberias/: docker compose ${comando}`);
    return esperar(5_000);
  }
  console.log(`>>> docker compose ${comando}`);
  return new Promise((resolver) => {
    exec(`docker compose ${comando}`, { cwd: RAIZ_COMPOSE }, (error, _salida, errores) => {
      if (error) console.error(`docker compose falló: ${errores || error.message}`);
      resolver();
    });
  });
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

async function api(token: string, ruta: string, cuerpo: object, clave?: string) {
  const inicio = performance.now();
  const respuesta = await fetch(`${API}${ruta}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...(clave && { 'idempotency-key': clave }),
    },
    body: JSON.stringify(cuerpo),
  });
  const ms = Math.round(performance.now() - inicio);
  return { estado: respuesta.status, ms, cuerpo: (await respuesta.json()) as Record<string, unknown> };
}

interface Correo {
  id: string;
  asunto: string;
  texto: string;
}

/** Correos de Mailpit para `destino` (vacío si Mailpit no responde). */
async function correosPara(destino: string): Promise<Correo[]> {
  try {
    const lista = (await (await fetch(`${MAILPIT}/messages?limit=500`)).json()) as {
      messages: { ID: string; Subject: string; To: { Address: string }[] }[];
    };
    const propios = lista.messages.filter((m) => m.To.some((t) => t.Address === destino));
    return Promise.all(
      propios.map(async (m) => ({
        id: m.ID,
        asunto: m.Subject,
        texto: ((await (await fetch(`${MAILPIT}/message/${m.ID}`)).json()) as { Text: string }).Text,
      })),
    );
  } catch {
    return [];
  }
}

/** Espera hasta que haya un correo para `destino` con el asunto indicado; devuelve los que coinciden. */
async function esperarCorreo(
  destino: string,
  asunto: RegExp,
): Promise<{ correos: Correo[]; segundos: number }> {
  const inicio = performance.now();
  while (performance.now() - inicio < ESPERA_MS) {
    const correos = (await correosPara(destino)).filter((c) => asunto.test(c.asunto));
    if (correos.length > 0) {
      // Un momento más, para ver si llega un duplicado.
      await esperar(20_000);
      return {
        correos: (await correosPara(destino)).filter((c) => asunto.test(c.asunto)),
        segundos: Math.round((performance.now() - inicio) / 1000),
      };
    }
    await esperar(2_000);
  }
  return { correos: [], segundos: Math.round(ESPERA_MS / 1000) };
}

const resumenCorreo = (correos: Correo[]) => ({
  recibidos: correos.length,
  uno_solo: correos.length === 1,
  sin_telefono: correos.every((c) => !c.texto.includes(TELEFONO)),
});

async function recorridoCorreoCaido(s: Sembrado, token: string) {
  const cita = await api(
    token,
    '/citas',
    {
      servicioId: s.servicioId,
      barberoId: s.barberoId,
      inicio: `${s.fecha}T10:00:00-05:00`,
      clienteId: s.clienteId,
    },
    randomUUID(),
  );
  console.log(`1. Cita registrada: ${cita.estado} en ${cita.ms} ms. Esperando la confirmación en Mailpit…`);
  const confirmacion = await esperarCorreo(s.correoCliente, /confirmada/i);
  console.log(`   ${confirmacion.correos.length} correo(s) de confirmación en ${confirmacion.segundos} s.`);

  await compose('stop mailpit');
  const reprogramada = await api(token, `/citas/${String(cita.cuerpo.id)}/reprogramar`, {
    inicio: `${s.fecha}T11:30:00-05:00`,
  });
  console.log(`2. Con Mailpit detenido, reprogramación: ${reprogramada.estado} en ${reprogramada.ms} ms.`);

  await compose('start mailpit');
  console.log('3. Mailpit en marcha. Esperando el aviso de reprogramación (pausa del circuito + intervalo)…');
  const reprogramacion = await esperarCorreo(s.correoCliente, /reprogramada/i);
  const texto = reprogramacion.correos[0]?.texto ?? '';
  return {
    paso1_confirmacion: { cita: cita.estado, ms: cita.ms, ...resumenCorreo(confirmacion.correos) },
    paso2_reprogramar_con_correo_detenido: { estado: reprogramada.estado, ms: reprogramada.ms },
    paso3_aviso_al_volver: {
      ...resumenCorreo(reprogramacion.correos),
      segundos_hasta_llegar: reprogramacion.segundos,
      con_hora_anterior_y_nueva: texto.includes('10:00') && texto.includes('11:30'),
    },
  };
}

async function recorridoCaida(s: Sembrado, token: string) {
  const cita = await api(
    token,
    '/citas',
    {
      servicioId: s.servicioId,
      barberoId: s.barberoId,
      inicio: `${s.fecha}T15:00:00-05:00`,
      clienteId: s.clienteId,
    },
    randomUUID(),
  );
  console.log(`16. Cita registrada: ${cita.estado}. Deteniendo backend-1 de inmediato…`);
  await compose('stop backend-1');
  const confirmacion = await esperarCorreo(s.correoCliente, /confirmada/i);
  await compose('up -d --no-deps backend-1');
  return {
    paso16_caida_de_backend_1: {
      cita: cita.estado,
      ...resumenCorreo(confirmacion.correos),
      segundos_hasta_llegar: confirmacion.segundos,
    },
  };
}

async function principal(): Promise<void> {
  const db = new Pool({ connectionString: DB, max: 2 });
  let sembrado: Sembrado | null = null;
  try {
    sembrado = await sembrar(db);
    const token = await iniciarSesion(sembrado.correoPropietario);
    const resultado =
      RECORRIDO === 'caida'
        ? await recorridoCaida(sembrado, token)
        : await recorridoCorreoCaido(sembrado, token);
    const { rows } = await db.query(
      `SELECT kind, status, attempts, last_error FROM notification WHERE tenant_id = $1 ORDER BY created_at`,
      [sembrado.tenantId],
    );
    const resumen = { recorrido: RECORRIDO, ...resultado, avisos_en_la_base: rows };
    console.log(JSON.stringify(resumen, null, 2));
    mkdirSync(dirname(SALIDA), { recursive: true });
    writeFileSync(SALIDA, JSON.stringify(resumen, null, 2));
    console.log(`Resumen en ${SALIDA}`);
  } finally {
    if (sembrado) await limpiar(db, sembrado);
    await db.end();
  }
}

principal().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
