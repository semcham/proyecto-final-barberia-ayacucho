import type { Response } from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarCita } from '../../helpers/fixtures';
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

// T040 · PR16 con reprogramaciones (US1-3; SC-001; principio IV; research R01 a R03). Solicitudes simultáneas
// repartidas entre DOS instancias de la aplicación sobre la misma base: exactamente una ocupa la hora, las demás
// reciben 409 y ninguna perdedora pierde su hora original. Sin respuestas 5xx (tampoco por bloqueo mutuo al
// cambiar de barbero).

jest.setTimeout(240_000);

interface Resumen {
  e2xx: number;
  e409: number;
  e5xx: number;
  otros: number[];
  codigos409: Record<string, number>;
}

function resumir(respuestas: Response[]): Resumen {
  const resumen: Resumen = { e2xx: 0, e409: 0, e5xx: 0, otros: [], codigos409: {} };
  for (const r of respuestas) {
    if (r.status >= 200 && r.status < 300) resumen.e2xx += 1;
    else if (r.status === 409) {
      resumen.e409 += 1;
      resumen.codigos409[r.body.codigo] = (resumen.codigos409[r.body.codigo] ?? 0) + 1;
    } else if (r.status >= 500) resumen.e5xx += 1;
    else resumen.otros.push(r.status);
  }
  return resumen;
}

interface CitaDeCliente {
  token: string;
  citaId: string;
  inicio: Date;
}

/** HH:MM de la franja `i` (09:00, 09:30, ..., 18:30): 20 por día. */
const franja = (i: number) => {
  const minutos = 9 * 60 + (i % 20) * 30;
  return `${String(Math.floor(minutos / 60)).padStart(2, '0')}:${String(minutos % 60).padStart(2, '0')}`;
};

describe('PR16 · Reprogramaciones simultáneas a la misma hora (T040, 2 instancias)', () => {
  let instancias: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((instancia) => instancia.cerrar()));
    await cerrarPools();
  });

  /**
   * `n` clientes, cada uno con una cita del barbero en una franja distinta a partir del día `desdeDia` (20
   * franjas por día). Las sesiones se crean en tandas para no saturar Argon2.
   */
  async function citasDeClientes(
    e: BarberiaParaReservar,
    barberoId: string,
    n: number,
    desdeDia: number,
  ): Promise<CitaDeCliente[]> {
    const citas: CitaDeCliente[] = [];
    for (let i = 0; i < n; i += 20) {
      const tanda = await Promise.all(
        Array.from({ length: Math.min(20, n - i) }, async (_, j) => {
          const k = i + j;
          const sesion = await sesionCliente(e.barberia.tenantId);
          const inicio = new Date(horaLima(fechaEnDias(desdeDia + Math.floor(k / 20)), franja(k)));
          const citaId = await sembrarCita({
            tenantId: e.barberia.tenantId,
            barberoId,
            servicioId: e.servicioId,
            clienteId: sesion.cliente.clienteId,
            inicio,
          });
          return { token: sesion.token, citaId, inicio };
        }),
      );
      citas.push(...tanda);
    }
    return citas;
  }

  const reprogramar = (i: number, c: CitaDeCliente, cuerpo: object) =>
    instancias[i % 2].agente
      .post(`/api/v1/citas/${c.citaId}/reprogramar`)
      .set({ Authorization: `Bearer ${c.token}` })
      .send(cuerpo);

  /** Las citas que no ganaron siguen en su hora original, con su barbero y en la versión 1. */
  async function perdedorasIntactas(citas: CitaDeCliente[], respuestas: Response[], barberoId: string) {
    const perdedoras = citas.filter((_, i) => respuestas[i].status === 409);
    const { rows } = await poolDe('seed').query<{
      id: string;
      starts_at: Date;
      barber_id: string;
      version: number;
      status: string;
    }>('SELECT id, starts_at, barber_id, version, status FROM appointment WHERE id = ANY($1::uuid[])', [
      perdedoras.map((c) => c.citaId),
    ]);
    const porId = new Map(rows.map((fila) => [fila.id, fila]));
    for (const c of perdedoras) {
      expect(porId.get(c.citaId)).toMatchObject({
        starts_at: c.inicio,
        barber_id: barberoId,
        version: 1,
        status: 'CONFIRMADA',
      });
    }
  }

  it('50 citas distintas a la misma hora libre del mismo barbero → 1 éxito, 49 × 409, 0 × 5xx', async () => {
    const e = await barberiaParaReservar();
    const citas = await citasDeClientes(e, e.barberoId, 50, 2);
    const destino = horaLima(fechaEnDias(6), '10:00');

    const respuestas = await Promise.all(citas.map((c, i) => reprogramar(i, c, { inicio: destino })));
    const resumen = resumir(respuestas);
    expect(resumen).toEqual({
      e2xx: 1,
      e409: 49,
      e5xx: 0,
      otros: [],
      codigos409: { HORARIO_NO_DISPONIBLE: 49 },
    });
    expect(await citasActivasEn(e.barberoId, destino, horaLima(fechaEnDias(6), '10:30'))).toBe(1);
    await perdedorasIntactas(citas, respuestas, e.barberoId);
    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS total FROM appointment_reschedule WHERE tenant_id = $1',
      [e.barberia.tenantId],
    );
    expect(rows[0].total).toBe(1);
  });

  it('25 reservas nuevas y 25 reprogramaciones a la misma hora → 1 éxito en total, 49 × 409, 0 × 5xx', async () => {
    const e = await barberiaParaReservar();
    const citas = await citasDeClientes(e, e.barberoId, 25, 2);
    const nuevos = await Promise.all(Array.from({ length: 25 }, () => sesionCliente(e.barberia.tenantId)));
    const destino = horaLima(fechaEnDias(6), '11:00');

    const solicitudes: Promise<Response>[] = [];
    for (let i = 0; i < 25; i += 1) {
      solicitudes.push(reprogramar(i, citas[i], { inicio: destino }));
      solicitudes.push(
        instancias[(i + 1) % 2].agente
          .post('/api/v1/citas')
          .set({ Authorization: `Bearer ${nuevos[i].token}`, 'Idempotency-Key': nuevaClave() })
          .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: destino }),
      );
    }
    const respuestas = await Promise.all(solicitudes);
    const resumen = resumir(respuestas);
    expect(resumen).toMatchObject({ e2xx: 1, e409: 49, e5xx: 0, otros: [] });
    expect(resumen.codigos409).toEqual({ HORARIO_NO_DISPONIBLE: 49 });
    expect(await citasActivasEn(e.barberoId, destino, horaLima(fechaEnDias(6), '11:30'))).toBe(1);
    const reprogramaciones = respuestas.filter((_, i) => i % 2 === 0);
    await perdedorasIntactas(citas, reprogramaciones, e.barberoId);
  });

  it('cambios cruzados de barbero (A → B y B → A) a la vez: sin bloqueo mutuo, 1 éxito por destino', async () => {
    const e = await barberiaParaReservar();
    const deA = await citasDeClientes(e, e.barberoId, 20, 2);
    const deB = await citasDeClientes(e, e.otroBarberoId, 20, 2);
    const destino = horaLima(fechaEnDias(6), '12:00');

    const solicitudes: Promise<Response>[] = [];
    for (let i = 0; i < 20; i += 1) {
      solicitudes.push(reprogramar(i, deA[i], { inicio: destino, barberoId: e.otroBarberoId }));
      solicitudes.push(reprogramar(i + 1, deB[i], { inicio: destino, barberoId: e.barberoId }));
    }
    const respuestas = await Promise.all(solicitudes);
    const resumen = resumir(respuestas);
    expect(resumen).toMatchObject({ e2xx: 2, e409: 38, e5xx: 0, otros: [] });
    expect(resumen.codigos409).toEqual({ HORARIO_NO_DISPONIBLE: 38 });
    expect(await citasActivasEn(e.barberoId, destino, horaLima(fechaEnDias(6), '12:30'))).toBe(1);
    expect(await citasActivasEn(e.otroBarberoId, destino, horaLima(fechaEnDias(6), '12:30'))).toBe(1);
    await perdedorasIntactas(
      deA,
      respuestas.filter((_, i) => i % 2 === 0),
      e.barberoId,
    );
    await perdedorasIntactas(
      deB,
      respuestas.filter((_, i) => i % 2 === 1),
      e.otroBarberoId,
    );
  });
});
