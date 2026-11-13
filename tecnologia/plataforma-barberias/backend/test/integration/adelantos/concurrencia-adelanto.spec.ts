import { activarAdelanto, reservar } from '../../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { barberiaParaReservar, citasActivasEn, fechaEnDias, horaLima } from '../../helpers/reservas';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T022 de 008 · PR16 con el adelanto activo (SC-007; principio IV, ADR-009): 50 reservas simultáneas del mismo
// horario, repartidas entre DOS instancias, dejan una sola cita PENDIENTE con un solo adelanto; el resto recibe 409 y
// ninguna 5xx. La garantía sigue siendo la restricción de exclusión de PostgreSQL (PENDIENTE también ocupa).

jest.setTimeout(240_000);

describe('PR16 · Reservas simultáneas con adelanto (T022, 2 instancias)', () => {
  let instancias: [AppDePrueba, AppDePrueba];

  beforeAll(async () => {
    instancias = [await crearApp(), await crearApp()];
  });

  afterAll(async () => {
    await Promise.all(instancias.map((instancia) => instancia.cerrar()));
    await cerrarPools();
  });

  it('50 reservas del mismo horario → 1 PENDIENTE con 1 adelanto, 49 × 409 HORARIO_NO_DISPONIBLE, 0 × 5xx', async () => {
    const e = await barberiaParaReservar();
    await activarAdelanto(e.barberia.tenantId, e.barberia.propietarioId);
    const tokens: string[] = [];
    for (let i = 0; i < 50; i += 10) {
      const tanda = await Promise.all(Array.from({ length: 10 }, () => sesionCliente(e.barberia.tenantId)));
      tokens.push(...tanda.map((s) => s.token));
    }
    const fecha = fechaEnDias(3);
    const inicio = horaLima(fecha, '10:00');
    const respuestas = await Promise.all(
      tokens.map((token, i) =>
        reservar(instancias[i % 2], token, { servicioId: e.servicioId, barberoId: e.barberoId, inicio }),
      ),
    );

    const estados = respuestas.map((r) => r.status);
    const resumen = {
      e201: estados.filter((s) => s === 201).length,
      e409: estados.filter((s) => s === 409).length,
      e5xx: estados.filter((s) => s >= 500).length,
      otros: estados.filter((s) => s !== 201 && s !== 409 && s < 500),
      codigos409: [...new Set(respuestas.filter((r) => r.status === 409).map((r) => r.body.codigo))],
    };
    console.info('PR16 con adelanto', JSON.stringify(resumen));
    expect(resumen).toEqual({
      e201: 1,
      e409: 49,
      e5xx: 0,
      otros: [],
      codigos409: ['HORARIO_NO_DISPONIBLE'],
    });

    const ganadora = respuestas.find((r) => r.status === 201);
    expect(ganadora?.body).toMatchObject({ estado: 'PENDIENTE', adelanto: { estado: 'POR_PAGAR' } });
    expect(await citasActivasEn(e.barberoId, inicio, horaLima(fecha, '10:30'))).toBe(1);
    const { rows } = await poolDe('seed').query<{ n: number; pendientes: number }>(
      `SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'POR_PAGAR')::int AS pendientes
         FROM booking_deposit WHERE tenant_id = $1`,
      [e.barberia.tenantId],
    );
    expect(rows[0]).toEqual({ n: 1, pendientes: 1 });
    // Ninguna reserva perdedora dejó un evento AdelantoSolicitado.
    const eventos = await poolDe('seed').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND type = 'AdelantoSolicitado'`,
      [e.barberia.tenantId],
    );
    expect(eventos.rows[0].n).toBe(1);
  });
});
