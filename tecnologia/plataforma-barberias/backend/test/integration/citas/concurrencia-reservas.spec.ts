import type { Response } from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  citasActivasEn,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T075 · PR16 (EQ-16, SC-001; principio IV, ADR-009): nunca dos citas activas del mismo barbero que se
// solapen, con solicitudes simultáneas repartidas entre DOS instancias de la aplicación (cada una con su
// propio pool) sobre la misma base. La garantía la da la restricción de exclusión de PostgreSQL.

jest.setTimeout(240_000);

const CITAS = '/api/v1/citas';

interface Resumen {
  e201: number;
  e200: number;
  e409: number;
  e5xx: number;
  otros: number[];
  codigos409: Record<string, number>;
}

function resumir(respuestas: Response[]): Resumen {
  const resumen: Resumen = { e201: 0, e200: 0, e409: 0, e5xx: 0, otros: [], codigos409: {} };
  for (const r of respuestas) {
    if (r.status === 201) resumen.e201 += 1;
    else if (r.status === 200) resumen.e200 += 1;
    else if (r.status === 409) {
      resumen.e409 += 1;
      resumen.codigos409[r.body.codigo] = (resumen.codigos409[r.body.codigo] ?? 0) + 1;
    } else if (r.status >= 500) resumen.e5xx += 1;
    else resumen.otros.push(r.status);
  }
  return resumen;
}

/** Siembra `n` clientes con sesión en la barbería, en tandas para no saturar Argon2. */
async function clientesConSesion(tenantId: string, n: number): Promise<string[]> {
  const tokens: string[] = [];
  for (let i = 0; i < n; i += 20) {
    const tanda = await Promise.all(
      Array.from({ length: Math.min(20, n - i) }, () => sesionCliente(tenantId)),
    );
    tokens.push(...tanda.map((sesion) => sesion.token));
  }
  return tokens;
}

describe('PR16 · Reservas simultáneas del mismo horario (2 instancias)', () => {
  let instancias: [AppDePrueba, AppDePrueba];
  let escenario: BarberiaParaReservar;
  let tokens: string[];
  const fecha = fechaEnDias(3);

  const reservar = (indice: number, token: string, cuerpo: object, clave = nuevaClave()) =>
    instancias[indice % 2].agente
      .post(CITAS)
      .set({ Authorization: `Bearer ${token}`, 'Idempotency-Key': clave })
      .send(cuerpo);

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
    escenario = await barberiaParaReservar();
    tokens = await clientesConSesion(escenario.barberia.tenantId, 200);
  });

  afterAll(async () => {
    await Promise.all(instancias.map((instancia) => instancia.cerrar()));
    await cerrarPools();
  });

  it('la garantía es la restricción de exclusión: sin bloqueo consultivo, la base rechaza el solape (23P01)', async () => {
    // Inserción directa, sin pasar por el caso de uso ni por pg_advisory_xact_lock.
    const seed = poolDe('seed');
    const { rows } = await seed.query<{ customer_id: string }>(
      'SELECT id AS customer_id FROM customer_profile WHERE tenant_id = $1 LIMIT 2',
      [escenario.barberia.tenantId],
    );
    const insertar = (clienteId: string, inicio: string, fin: string) =>
      seed.query(
        `INSERT INTO appointment (id, tenant_id, barber_id, service_id, customer_id, service_name, price,
           duration_min, starts_at, ends_at, status, origin, created_by)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'Corte', 20, 30, $5, $6, 'CONFIRMADA', 'EN_LINEA', gen_random_uuid())`,
        [escenario.barberia.tenantId, escenario.barberoId, escenario.servicioId, clienteId, inicio, fin],
      );
    await insertar(rows[0].customer_id, horaLima(fecha, '18:00'), horaLima(fecha, '18:30'));
    await expect(
      insertar(rows[1].customer_id, horaLima(fecha, '18:15'), horaLima(fecha, '18:45')),
    ).rejects.toMatchObject({ code: '23P01', constraint: 'appointment_no_overlap_barber' });
    // Contigua ([18:30, 19:00)) sí se acepta: el rango es semiabierto.
    await expect(
      insertar(rows[1].customer_id, horaLima(fecha, '18:30'), horaLima(fecha, '19:00')),
    ).resolves.toBeDefined();
  });

  it('las dos instancias son aplicaciones distintas con su propio pool', () => {
    expect(instancias[0].app).not.toBe(instancias[1].app);
    expect(instancias[0].app.getHttpServer()).not.toBe(instancias[1].app.getHttpServer());
  });

  it('200 reservas simultáneas al mismo barbero e inicio → 1 cita (201), 199 × 409 HORARIO_NO_DISPONIBLE, 0 × 5xx', async () => {
    const inicio = horaLima(fecha, '10:00');
    const cuerpo = { servicioId: escenario.servicioId, barberoId: escenario.barberoId, inicio };
    const respuestas = await Promise.all(tokens.map((token, i) => reservar(i, token, cuerpo)));
    const resumen = resumir(respuestas);
    const activas = await citasActivasEn(escenario.barberoId, inicio, horaLima(fecha, '10:30'));
    // Números de PR16 visibles en la salida de la prueba.
    console.info('PR16 principal', JSON.stringify({ ...resumen, citasActivas: activas }));

    expect(resumen).toEqual({
      e201: 1,
      e200: 0,
      e409: 199,
      e5xx: 0,
      otros: [],
      codigos409: { HORARIO_NO_DISPONIBLE: 199 },
    });
    expect(activas).toBe(1);
  });

  it('(a) solape parcial: 100 a las 12:00 y 100 a las 12:15 (30 min) → 1 cita activa', async () => {
    const respuestas = await Promise.all(
      tokens.map((token, i) =>
        reservar(i, token, {
          servicioId: escenario.servicioId,
          barberoId: escenario.barberoId,
          inicio: horaLima(fecha, i % 2 === 0 ? '12:00' : '12:15'),
        }),
      ),
    );
    const resumen = resumir(respuestas);
    const activas = await citasActivasEn(
      escenario.barberoId,
      horaLima(fecha, '12:00'),
      horaLima(fecha, '12:45'),
    );
    console.info('PR16 (a) solape parcial', JSON.stringify({ ...resumen, citasActivas: activas }));
    expect(resumen.e201).toBe(1);
    expect(resumen.e409).toBe(199);
    expect(resumen.e5xx).toBe(0);
    expect(activas).toBe(1);
  });

  it('(b) el mismo cliente con dos barberos a la misma hora → 1 cita; la otra 409 CITA_SOLAPADA_DEL_CLIENTE', async () => {
    const token = tokens[0];
    const inicio = horaLima(fecha, '15:00');
    const [r1, r2] = await Promise.all([
      reservar(0, token, { servicioId: escenario.servicioId, barberoId: escenario.barberoId, inicio }),
      reservar(1, token, { servicioId: escenario.servicioId, barberoId: escenario.otroBarberoId, inicio }),
    ]);
    const resumen = resumir([r1, r2]);
    console.info('PR16 (b) mismo cliente', JSON.stringify(resumen));
    expect(resumen).toEqual({
      e201: 1,
      e200: 0,
      e409: 1,
      e5xx: 0,
      otros: [],
      codigos409: { CITA_SOLAPADA_DEL_CLIENTE: 1 },
    });
    const total =
      (await citasActivasEn(escenario.barberoId, inicio, horaLima(fecha, '15:30'))) +
      (await citasActivasEn(escenario.otroBarberoId, inicio, horaLima(fecha, '15:30')));
    expect(total).toBe(1);
  });

  it('(c) 50 reintentos simultáneos con la misma Idempotency-Key → 1 cita y todas las respuestas con el mismo id', async () => {
    const token = tokens[1];
    const clave = nuevaClave();
    const inicio = horaLima(fecha, '17:00');
    const cuerpo = { servicioId: escenario.servicioId, barberoId: escenario.otroBarberoId, inicio };
    const respuestas = await Promise.all(
      Array.from({ length: 50 }, (_, i) => reservar(i, token, cuerpo, clave)),
    );
    const resumen = resumir(respuestas);
    const ids = new Set(respuestas.map((r) => r.body.id));
    const { rows } = await poolDe('seed').query<{ total: number }>(
      'SELECT count(*)::int AS total FROM appointment WHERE idempotency_key = $1',
      [clave],
    );
    console.info(
      'PR16 (c) idempotencia',
      JSON.stringify({ ...resumen, idsDistintos: ids.size, filas: rows[0].total }),
    );
    expect(resumen.e201).toBe(1);
    expect(resumen.e200).toBe(49);
    expect(resumen.e409 + resumen.e5xx + resumen.otros.length).toBe(0);
    expect(ids.size).toBe(1);
    expect(rows[0].total).toBe(1);
  });
});
