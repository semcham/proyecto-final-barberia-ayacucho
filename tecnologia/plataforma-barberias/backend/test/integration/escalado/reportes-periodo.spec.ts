import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarbero, sembrarCliente } from '../../helpers/fixtures';
import { pedirReportes } from '../../helpers/reportes';
import { type BarberiaParaReservar, barberiaParaReservar } from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T019 de 005 · SC-005: el propietario obtiene los tres reportes de un mes en 2 s o menos, y el de 366 días también
// responde. Volumen: la barbería medida tiene 3 barberos y unas 22 000 citas en un año (unas 1 800 al mes, una
// barbería muy ocupada); además hay 10 barberías más con 3 000 citas cada una en el mismo mes, para que el índice
// appointment (tenant_id, starts_at) tenga que separar barberías. Como las demás pruebas de `escalado`, si falla solo
// por tiempo se repite sola.

const DIAS_DEL_ANIO = 366;
const CITAS_DEL_ANIO = 22_000;
const OTRAS_BARBERIAS = 10;
const CITAS_POR_OTRA = 3_000;
const LIMITE_MS = 2000;

/**
 * Citas sembradas en bloque, sin RLS. Todas en estados no activos (completada, cancelada o no asistió): no chocan con
 * las restricciones de exclusión de horario, que solo cubren las pendientes y las confirmadas.
 */
async function sembrarEnBloque(opciones: {
  tenantId: string;
  barberos: string[];
  servicioId: string;
  clienteId: string;
  desde: string;
  dias: number;
  cantidad: number;
}): Promise<void> {
  await poolDe('seed').query(
    `INSERT INTO appointment
       (id, tenant_id, barber_id, service_id, customer_id, service_name, price, duration_min, starts_at, ends_at,
        status, origin, created_by, cancelled_at, late_cancellation)
     SELECT gen_random_uuid(), $1, ($2::uuid[])[1 + g % array_length($2::uuid[], 1)], $3, $4,
            (ARRAY['Corte clásico', 'Barba', 'Corte y barba', 'Tinte', 'Cejas', 'Lavado'])[1 + g % 6], '20.00', 30,
            inicio, inicio + interval '30 minutes',
            CASE WHEN g % 10 = 0 THEN 'CANCELADA' WHEN g % 17 = 0 THEN 'NO_ASISTIO' ELSE 'COMPLETADA' END,
            'EN_LINEA', gen_random_uuid(),
            CASE WHEN g % 10 = 0 THEN inicio END, g % 20 = 0
       FROM generate_series(0, $7::int - 1) AS g,
            LATERAL (SELECT ($5::date::timestamp AT TIME ZONE 'America/Lima')
                            + (g % $6::int) * interval '1 day'
                            + interval '9 hours' + ((g / $6::int) % 24) * interval '30 minutes' AS inicio) AS h`,
    [
      opciones.tenantId,
      opciones.barberos,
      opciones.servicioId,
      opciones.clienteId,
      opciones.desde,
      opciones.dias,
      opciones.cantidad,
    ],
  );
}

async function barberiaConCitas(
  desde: string,
  dias: number,
  cantidad: number,
): Promise<BarberiaParaReservar> {
  const e = await barberiaParaReservar();
  const tenantId = e.barberia.tenantId;
  const tercero = (await sembrarBarbero({ tenantId, servicios: [e.servicioId] })).barberoId;
  const { clienteId } = await sembrarCliente({ tenantId });
  await sembrarEnBloque({
    tenantId,
    barberos: [e.barberoId, e.otroBarberoId, tercero],
    servicioId: e.servicioId,
    clienteId,
    desde,
    dias,
    cantidad,
  });
  return e;
}

/** Duración de una solicitud, en milisegundos. */
async function medir(fn: () => Promise<unknown>): Promise<number> {
  const inicio = performance.now();
  await fn();
  return Math.round(performance.now() - inicio);
}

describe('T019 · SC-005: reportes de un mes en 2 s o menos', () => {
  let prueba: AppDePrueba;
  let token: string;
  let tenantId: string;

  beforeAll(async () => {
    prueba = await crearApp();
    const e = await barberiaConCitas('2026-01-01', DIAS_DEL_ANIO, CITAS_DEL_ANIO);
    tenantId = e.barberia.tenantId;
    for (let i = 0; i < OTRAS_BARBERIAS; i++) await barberiaConCitas('2026-11-01', 30, CITAS_POR_OTRA);
    await poolDe('seed').query('ANALYZE appointment');
    token = await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  }, 240_000);

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el volumen sembrado es el previsto', async () => {
    const { rows } = await poolDe('seed').query<{ total: number; delMes: number }>(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE starts_at >= '2026-11-01T05:00:00Z' AND starts_at < '2026-12-01T05:00:00Z')::int
                AS "delMes"
         FROM appointment WHERE tenant_id = $1`,
      [tenantId],
    );
    expect(rows[0].total).toBe(CITAS_DEL_ANIO);
    expect(rows[0].delMes).toBeGreaterThan(1500);
  });

  it(`un mes: cada una de tres consultas responde en ${LIMITE_MS} ms o menos (la primera, en frío)`, async () => {
    const tiempos: number[] = [];
    let total = 0;
    for (let i = 0; i < 3; i++) {
      tiempos.push(
        await medir(async () => {
          const { body } = await pedirReportes(prueba, token, {
            desde: '2026-11-01',
            hasta: '2026-11-30',
          }).expect(200);
          total = body.citas.total;
        }),
      );
    }
    console.info('SC-005 · reportes de un mes', { citasDelMes: total, tiemposMs: tiempos });
    expect(total).toBeGreaterThan(1500);
    for (const tiempo of tiempos) expect(tiempo).toBeLessThanOrEqual(LIMITE_MS);
  });

  it('366 días también responde (200), con todas las citas del año', async () => {
    let total = 0;
    const tiempo = await medir(async () => {
      const { body } = await pedirReportes(prueba, token, {
        desde: '2026-01-01',
        hasta: '2027-01-01',
      }).expect(200);
      total = body.citas.total;
    });
    console.info('SC-005 · reportes de 366 días', { citas: total, tiempoMs: tiempo });
    expect(total).toBe(CITAS_DEL_ANIO);
  });
});
