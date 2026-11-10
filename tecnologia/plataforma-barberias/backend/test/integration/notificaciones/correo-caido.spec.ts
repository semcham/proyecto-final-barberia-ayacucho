import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  esperarCorreos,
  iniciarProxySmtp,
  type ProxySmtp,
  descartarAvisosDeOtrasPruebas,
} from '../../helpers/avisos';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
} from '../../helpers/reservas';
import { sesionCliente, tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T062 · Correo caído (PR06; US2-5; SC-003; FR-011, FR-032). Con el servidor de correo detenido, reservar,
// cancelar y reprogramar responden igual: la solicitud NUNCA abre una conexión SMTP (el envío es de la tarea
// enviar-avisos). Los avisos quedan pendientes; 5 fallos en 60 s abren el circuito y, con el circuito abierto,
// no se intenta conectar ni se consume un intento. Al volver el correo, cada aviso llega UNA vez.
//
// El correo "detenido" es un proxy TCP delante de Mailpit que corta cada conexión (helpers/avisos.ts).

jest.setTimeout(180_000);

describe('Correo caído (T062, US2-5)', () => {
  let mailpit: Mailpit;
  let proxy: ProxySmtp;
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let propietario: string;
  const como = (token: string) => ({ Authorization: `Bearer ${token}` });
  const dia = fechaEnDias(3);

  const reservar = (token: string, hora: string) =>
    prueba.agente
      .post('/api/v1/citas')
      .set({ ...como(token), 'Idempotency-Key': nuevaClave() })
      .send({ servicioId: e.servicioId, barberoId: e.barberoId, inicio: horaLima(dia, hora) });

  /** Reservar, cancelar y reprogramar: estados y duración de cada solicitud. */
  async function tresOperaciones(horas: [string, string, string]) {
    const tiempos: number[] = [];
    const medir = async <T>(fn: () => Promise<T>) => {
      const inicio = performance.now();
      const resultado = await fn();
      tiempos.push(performance.now() - inicio);
      return resultado;
    };
    const a = await sesionCliente(e.barberia.tenantId);
    const b = await sesionCliente(e.barberia.tenantId);
    const reserva = await medir(() => reservar(a.token, horas[0]));
    const deB = await reservar(b.token, horas[1]);
    const cancelada = await medir(() =>
      prueba.agente.post(`/api/v1/citas/${deB.body.id}/cancelar`).set(como(b.token)),
    );
    const reprogramada = await medir(() =>
      prueba.agente
        .post(`/api/v1/citas/${reserva.body.id}/reprogramar`)
        .set(como(propietario))
        .send({ inicio: horaLima(dia, horas[2]) }),
    );
    return {
      estados: [reserva.status, deB.status, cancelada.status, reprogramada.status],
      tiempos,
      clientes: [a, b],
    };
  }

  // Avisos pendientes que dejaron otros archivos: la tarea no debe intentarlos aquí (helpers/avisos.ts).
  beforeEach(() => descartarAvisosDeOtrasPruebas());

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    proxy = await iniciarProxySmtp(mailpit);
    prueba = await appConCorreo(proxy);
    e = await barberiaParaReservar();
    propietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await proxy.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('con el correo detenido, las operaciones responden igual, sin tocar el SMTP; al volver, cada aviso llega una vez', async () => {
    // Con el correo en marcha: la referencia.
    const conCorreo = await tresOperaciones(['09:00', '09:30', '10:00']);
    expect(conCorreo.estados).toEqual([201, 201, 200, 200]);

    // Correo detenido: mismas respuestas y ninguna conexión SMTP desde las solicitudes.
    proxy.caido = true;
    const sinCorreo = await tresOperaciones(['11:00', '11:30', '12:00']);
    expect(sinCorreo.estados).toEqual(conCorreo.estados);
    expect(proxy.rechazadas()).toBe(0);
    // La operación no espera al correo: muy por debajo del tiempo límite de envío (5 s).
    for (const ms of sinCorreo.tiempos) expect(ms).toBeLessThan(2000);

    // Nadie corrió todavía la tarea de envío: los avisos de las dos tandas están pendientes.
    const pendientes = (await avisosDe(e.barberia.tenantId)).filter((a) => a.status === 'PENDIENTE');
    // Por tanda: confirmación de A, de B, cancelación de B (cliente, propietario) y reprogramación de A (solo el
    // cliente, la hizo el propietario) → 5 avisos; 10 en total.
    expect(pendientes).toHaveLength(10);

    // La tarea intenta con el correo detenido: 5 fallos abren el circuito y el resto no se intenta.
    await correrTareasDeAvisos(prueba);
    expect(proxy.rechazadas()).toBe(5);
    const trasFallar = await avisosDe(e.barberia.tenantId);
    const intentados = trasFallar.filter((a) => a.attempts === 1);
    const noIntentados = trasFallar.filter((a) => a.attempts === 0);
    expect(intentados).toHaveLength(5);
    expect(noIntentados).toHaveLength(5);
    for (const aviso of trasFallar) {
      expect(aviso.status).toBe('PENDIENTE');
      expect(aviso.last_error).toBe('CANAL_NO_DISPONIBLE');
    }

    // Con el circuito abierto, otra corrida no conecta.
    await poolDe('seed').query('UPDATE notification SET next_attempt_at = now() WHERE tenant_id = $1', [
      e.barberia.tenantId,
    ]);
    await correrTareasDeAvisos(prueba);
    expect(proxy.rechazadas()).toBe(5);

    // El correo vuelve. Pasada la pausa del circuito (30 s), la tarea envía todo, una vez.
    proxy.caido = false;
    await new Promise((resolver) => setTimeout(resolver, 31_000));
    await poolDe('seed').query('UPDATE notification SET next_attempt_at = now() WHERE tenant_id = $1', [
      e.barberia.tenantId,
    ]);
    await correrTareasDeAvisos(prueba);
    await correrTareasDeAvisos(prueba);

    const finales = await avisosDe(e.barberia.tenantId);
    expect(finales.every((a) => a.status === 'ENVIADO')).toBe(true);
    const [a1, b1] = conCorreo.clientes;
    const [a2, b2] = sinCorreo.clientes;
    for (const [cliente, esperados] of [
      [a1, 2],
      [b1, 2],
      [a2, 2],
      [b2, 2],
    ] as const) {
      const correos = await esperarCorreos(mailpit, cliente.cliente.correo as string, esperados);
      expect(correos).toHaveLength(esperados);
      expect(new Set(correos.map((c) => c.messageId)).size).toBe(esperados);
    }
    expect(await esperarCorreos(mailpit, e.barberia.correo, 2)).toHaveLength(2);
  });
});
