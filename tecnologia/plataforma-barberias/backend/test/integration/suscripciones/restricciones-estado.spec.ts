import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  sembrarBloqueo,
  sembrarCita,
  sembrarCliente,
  sembrarPago,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { filaDePago, notificar } from '../../helpers/pagos';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T054 · Restricciones por estado de la suscripción (FR-006, FR-007; contracts/restricciones-estado.md).
// La prueba lee las dos tablas del contrato y, para cada estado y cada caso de uso de §2, llama a la API
// real: 2xx si la acción está permitida, o 403 SUSCRIPCION_NO_PERMITE con el mensaje propio si no. Las
// lecturas siguen respondiendo y nada se borra ni se cancela. Además, SC-008: una barbería vencida que
// paga vuelve a aceptar reservas en la solicitud siguiente a la aprobación, sin esperar a la tarea.

const CONTRATO = join(
  __dirname,
  '../../../../../../specs/003-suscripciones-pagos/contracts/restricciones-estado.md',
);
const ESTADOS = ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED', 'SUSPENDED'] as const;
type Estado = (typeof ESTADOS)[number];
const MENSAJE_RESERVAR = 'Esta barbería no acepta reservas por ahora';
const MENSAJE_CAMBIO = 'Tu suscripción no permite este cambio';
const DIA = 24 * 60 * 60 * 1000;

/** Filas de una tabla Markdown que sigue al encabezado indicado. */
function tabla(texto: string, encabezado: string): string[][] {
  const desde = texto.indexOf(encabezado);
  if (desde < 0) throw new Error(`Falta la sección «${encabezado}» en el contrato`);
  const filas: string[][] = [];
  for (const linea of texto.slice(desde).split(/\r?\n/).slice(1)) {
    if (linea.startsWith('## ')) break;
    if (!linea.startsWith('|')) continue;
    const celdas = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    if (celdas.every((c) => /^-+$/.test(c))) continue;
    filas.push(celdas);
  }
  return filas.slice(1);
}

const contrato = readFileSync(CONTRATO, 'utf8');
const sinComillas = (celda: string) => celda.replace(/`/g, '').trim();

/** §1: acción → estados en los que está permitida. */
const politica = new Map<string, Set<Estado>>(
  tabla(contrato, '## 1. Acciones por estado').map(([accion, ...marcas]) => [
    sinComillas(accion),
    new Set(ESTADOS.filter((_, i) => marcas[i] === '✓')),
  ]),
);

/** §2: caso de uso → acción. */
const casosDelContrato = new Map<string, string>(
  tabla(contrato, '## 2. Casos de uso').flatMap(([casos, , accion]) =>
    [...casos.matchAll(/`(\w+)`/g)].map((m) => [m[1], sinComillas(accion)] as [string, string]),
  ),
);

interface Escenario {
  e: BarberiaParaReservar;
  propietario: string;
  cliente: string;
  presencialId: string;
  barberoActivo: string;
  barberoPendiente: string;
  citaFutura: string;
  citaPasada: string;
  citaIntacta: string;
  bloqueoId: string;
}

describe('Restricciones por estado de la suscripción (T054)', () => {
  let prueba: AppDePrueba;
  const como = (t: string) => ({ Authorization: `Bearer ${t}` });
  const todosLosDias = (inicio: string, fin: string) =>
    [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio, fin }));

  /** Cada caso de uso de §2 con una solicitud válida: si la política lo permite, responde 2xx. */
  const llamadas: Record<
    string,
    (s: Escenario) => Promise<{ status: number; body: Record<string, unknown> }>
  > = {
    ReservarCita: async (s) => {
      // Cliente en línea y cita presencial del propietario: las dos pasan por ReservarCita.
      const fecha = fechaEnDias(4);
      const cuerpo = { servicioId: s.e.servicioId, barberoId: s.e.barberoId };
      const enLinea = await prueba.agente
        .post('/api/v1/citas')
        .set({ ...como(s.cliente), 'Idempotency-Key': nuevaClave() })
        .send({ ...cuerpo, inicio: horaLima(fecha, '10:00') });
      const presencial = await prueba.agente
        .post('/api/v1/citas')
        .set({ ...como(s.propietario), 'Idempotency-Key': nuevaClave() })
        .send({ ...cuerpo, inicio: horaLima(fecha, '11:00'), clienteId: s.presencialId });
      expect(presencial.status).toBe(enLinea.status);
      expect(presencial.body).toMatchObject(enLinea.status === 201 ? {} : { codigo: enLinea.body.codigo });
      return enLinea;
    },
    CancelarCita: (s) =>
      prueba.agente.post(`/api/v1/citas/${s.citaFutura}/cancelar`).set(como(s.propietario)),
    CambiarEstadoCita: (s) =>
      prueba.agente
        .post(`/api/v1/citas/${s.citaPasada}/estado`)
        .set(como(s.propietario))
        .send({ estado: 'COMPLETADA' }),
    CrearServicio: (s) =>
      prueba.agente
        .post('/api/v1/servicios')
        .set(como(s.propietario))
        .send({ nombre: 'Barba', precio: '15', duracionMinutos: 30 }),
    ActualizarServicio: (s) =>
      prueba.agente
        .patch(`/api/v1/servicios/${s.e.servicioId}`)
        .set(como(s.propietario))
        .send({ precio: '25' }),
    CrearBarbero: (s) =>
      prueba.agente
        .post('/api/v1/barberos')
        .set(como(s.propietario))
        .send({ nombre: 'Rosa', servicioIds: [] }),
    ActualizarBarbero: (s) =>
      prueba.agente
        .patch(`/api/v1/barberos/${s.e.otroBarberoId}`)
        .set(como(s.propietario))
        .send({ nombre: 'Ana María' }),
    ReemplazarHorarioAtencion: (s) =>
      prueba.agente
        .put('/api/v1/barberia/horario')
        .set(como(s.propietario))
        .send({ tramos: todosLosDias('09:00', '19:00') }),
    ReemplazarDisponibilidad: (s) =>
      prueba.agente
        .put(`/api/v1/barberos/${s.e.otroBarberoId}/disponibilidad`)
        .set(como(s.propietario))
        .send({ tramos: todosLosDias('09:00', '19:00') }),
    CrearBloqueo: (s) => {
      const fecha = fechaEnDias(9);
      return prueba.agente
        .post(`/api/v1/barberos/${s.e.otroBarberoId}/bloqueos`)
        .set(como(s.propietario))
        .send({ inicio: horaLima(fecha, '09:00'), fin: horaLima(fecha, '10:00'), motivo: 'Trámite' });
    },
    EliminarBloqueo: (s) =>
      prueba.agente
        .delete(`/api/v1/barberos/${s.e.otroBarberoId}/bloqueos/${s.bloqueoId}`)
        .set(como(s.propietario)),
    CrearUsuario: (s) =>
      prueba.agente
        .post('/api/v1/usuarios')
        .set(como(s.propietario))
        .send({
          nombre: 'Barbero Nuevo',
          correo: `nuevo-${nuevaClave().slice(0, 8)}@prueba.pe`,
          rol: 'BARBERO',
        }),
    ActualizarUsuario: (s) =>
      prueba.agente
        .patch(`/api/v1/usuarios/${s.barberoActivo}`)
        .set(como(s.propietario))
        .send({ estado: 'DESACTIVADA' }),
    RegenerarActivacion: (s) =>
      prueba.agente.post(`/api/v1/usuarios/${s.barberoPendiente}/activacion`).set(como(s.propietario)),
  };

  /** Lecturas que no se restringen en ningún estado (§1). */
  const lecturas = (s: Escenario) => [
    prueba.agente.get('/api/v1/servicios').set(como(s.propietario)),
    prueba.agente.get('/api/v1/barberos').set(como(s.propietario)),
    prueba.agente.get('/api/v1/barberia/horario').set(como(s.propietario)),
    prueba.agente.get(`/api/v1/agenda?fecha=${fechaEnDias(5)}`).set(como(s.propietario)),
    prueba.agente.get('/api/v1/usuarios').set(como(s.propietario)),
    prueba.agente.get('/api/v1/suscripcion').set(como(s.propietario)),
    prueba.agente.get('/api/v1/suscripcion/estado-operativo').set(como(s.cliente)),
    prueba.agente.get('/api/v1/clientes/yo/citas').set(como(s.cliente)),
    prueba.agente.get(`/api/v1/publico/${s.e.barberia.slug}`),
  ];

  async function escenario(estado: Estado): Promise<Escenario> {
    const e = await barberiaParaReservar();
    const tenantId = e.barberia.tenantId;
    const propietario = await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    const cliente = await sesionCliente(tenantId);
    const presencial = await sembrarCliente({
      tenantId,
      conCuenta: false,
      creadoPor: e.barberia.propietarioId,
    });
    const activo = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const pendiente = await sembrarUsuario({
      tenantId,
      rol: 'BARBERO',
      estado: 'PENDIENTE',
      contrasena: null,
    });
    const cita = (inicio: Date) =>
      sembrarCita({
        tenantId,
        barberoId: e.otroBarberoId,
        servicioId: e.servicioId,
        clienteId: cliente.cliente.clienteId,
        inicio,
      });
    // A una hora fija de Lima dentro del horario (09:00 a 19:00): con la hora real, según el momento del día
    // la cita caería fuera y reemplazar el horario respondería 409 CONFLICTO_CON_CITAS.
    const citaFutura = await cita(new Date(horaLima(fechaEnDias(5), '12:00')));
    const citaPasada = await cita(new Date(horaLima(fechaEnDias(-1), '12:00')));
    const citaIntacta = await cita(new Date(horaLima(fechaEnDias(6), '12:00')));
    const inicioBloqueo = new Date(Date.now() + 11 * DIA);
    const bloqueoId = await sembrarBloqueo({
      tenantId,
      barberoId: e.otroBarberoId,
      inicio: inicioBloqueo,
      fin: new Date(inicioBloqueo.getTime() + 60 * 60 * 1000),
    });
    // El estado se fija directamente (el plan se queda en el de prueba: aquí solo importa el estado).
    await poolDe('seed').query(
      `UPDATE subscription
          SET status = $2::text,
              grace_ends_at = CASE WHEN $2::text = 'PAST_DUE' THEN now() + interval '3 days' END,
              suspended_at = CASE WHEN $2::text = 'SUSPENDED' THEN now() END,
              suspension_reason = CASE WHEN $2::text = 'SUSPENDED' THEN 'Revisión de la cuenta' END
        WHERE tenant_id = $1`,
      [tenantId, estado],
    );
    return {
      e,
      propietario,
      cliente: cliente.token,
      presencialId: presencial.clienteId,
      barberoActivo: activo.usuarioId,
      barberoPendiente: pendiente.usuarioId,
      citaFutura,
      citaPasada,
      citaIntacta,
      bloqueoId,
    };
  }

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el contrato y la prueba cubren los mismos casos de uso y cada acción tiene su fila', () => {
    expect([...casosDelContrato.keys()].sort()).toEqual(Object.keys(llamadas).sort());
    for (const accion of casosDelContrato.values()) expect(politica.has(accion)).toBe(true);
    expect(politica.size).toBe(5);
  });

  it.each(ESTADOS)('en %s cada caso de uso de §2 responde según la tabla de §1', async (estado) => {
    const s = await escenario(estado);
    const resultados: string[] = [];
    for (const [caso, accion] of casosDelContrato) {
      const permitida = politica.get(accion)!.has(estado);
      const { status, body } = await llamadas[caso](s);
      if (permitida) {
        if (status < 200 || status >= 300)
          resultados.push(`${caso}: esperaba 2xx y respondió ${status} ${body.codigo}`);
        continue;
      }
      const mensaje = accion === 'RESERVAR' ? MENSAJE_RESERVAR : MENSAJE_CAMBIO;
      if (status !== 403 || body.codigo !== 'SUSCRIPCION_NO_PERMITE' || body.mensaje !== mensaje) {
        resultados.push(
          `${caso}: esperaba 403 «${mensaje}» y respondió ${status} ${body.codigo} «${body.mensaje}»`,
        );
        continue;
      }
      expect(body.detalles).toEqual([{ estado, accion }]);
      expect(JSON.stringify(body)).not.toMatch(/horario no disponible/i);
    }
    expect(resultados).toEqual([]);

    // Las lecturas siguen respondiendo en cualquier estado.
    for (const respuesta of await Promise.all(lecturas(s))) expect(respuesta.status).toBe(200);

    // Nada se borra ni se cancela por el estado: la cita que nadie tocó sigue confirmada, y los datos siguen.
    const seed = poolDe('seed');
    const tenantId = s.e.barberia.tenantId;
    expect(
      (await seed.query('SELECT status FROM appointment WHERE id = $1', [s.citaIntacta])).rows[0].status,
    ).toBe('CONFIRMADA');
    const { rows } = await seed.query(
      `SELECT (SELECT count(*) FROM service WHERE tenant_id = $1)::int AS servicios,
              (SELECT count(*) FROM barber WHERE tenant_id = $1)::int AS barberos,
              (SELECT count(*) FROM appointment WHERE tenant_id = $1)::int AS citas`,
      [tenantId],
    );
    const permitido = (accion: string) => politica.get(accion)!.has(estado);
    expect(rows[0]).toEqual({
      servicios: permitido('CONFIGURAR_CATALOGO') ? 2 : 1,
      barberos: permitido('CONFIGURAR_CATALOGO') ? 3 : 2,
      citas: permitido('RESERVAR') ? 5 : 3,
    });
  });

  it('SC-008: una barbería vencida que paga acepta reservas en la solicitud siguiente, sin esperar a la tarea', async () => {
    const s = await escenario('EXPIRED');
    const tenantId = s.e.barberia.tenantId;
    // La prueba terminó hace un día: el período pagado empieza ahora.
    const { rows } = await poolDe('seed').query(
      `UPDATE subscription SET trial_ends_at = now() - interval '1 day', current_period_end = now() - interval '1 day'
        WHERE tenant_id = $1 RETURNING id, current_period_end`,
      [tenantId],
    );
    const reservar = (hora: string) =>
      prueba.agente
        .post('/api/v1/citas')
        .set({ ...como(s.cliente), 'Idempotency-Key': nuevaClave() })
        .send({
          servicioId: s.e.servicioId,
          barberoId: s.e.barberoId,
          inicio: horaLima(fechaEnDias(4), hora),
        });

    const antes = await reservar('15:00').expect(403);
    expect(antes.body.mensaje).toBe(MENSAJE_RESERVAR);
    const estado = await prueba.agente
      .get('/api/v1/suscripcion/estado-operativo')
      .set(como(s.cliente))
      .expect(200);
    expect(estado.body).toMatchObject({ aceptaReservas: false });

    const pago = await sembrarPago({
      tenantId,
      suscripcionId: rows[0].id,
      cubreDesde: rows[0].current_period_end,
    });
    await notificar(prueba, { referencia: pago.referencia }).expect(200);
    expect((await filaDePago(pago.pagoId)).status).toBe('APROBADO');

    await reservar('15:00').expect(201);
    const despues = await prueba.agente
      .get('/api/v1/suscripcion/estado-operativo')
      .set(como(s.cliente))
      .expect(200);
    expect(despues.body).toMatchObject({ aceptaReservas: true });
  });
});
