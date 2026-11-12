import { v7 as uuidv7 } from 'uuid';
import { AvisarFinDePrueba } from '../../../src/modules/suscripciones-pagos';
import { sumarUnMes } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/periodo';
import { EjecutorTareas } from '../../../src/shared';
import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  destinoDe,
  enviarSinCandado,
  esperarCorreos,
  iniciarProxySmtp,
  type ProxySmtp,
} from '../../helpers/avisos';
import { pagoEnRevision, revisar } from '../../helpers/comprobantes';
import { sembrarBarberia, sembrarPago, sembrarSuscripcion } from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit, type MensajeEnMailpit } from '../../helpers/mailpit';
import { filaDePago, notificar, PLAN_BASICO } from '../../helpers/pagos';
import { tokenPara, tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T124 de 004 · Avisos de suscripción al propietario (US5-1 a US5-5; FR-036 a FR-039; SC-013). Cada uno de los cuatro
// hechos (prueba por terminar, gracia, vencimiento y pago aprobado o rechazado) deja UN correo en texto simple al
// propietario, aunque corran dos instancias a la vez; con un período siguiente pagado no hay aviso de prueba por
// terminar; con el correo caído, la transición de 003 se completa igual y el correo llega una vez al volver; los
// mensajes no traen datos de pago sensibles (número de operación, referencia del pago ni importe).

jest.setTimeout(180_000);

const DIA = 24 * 60 * 60 * 1000;
const HORA = 60 * 60 * 1000;
const seed = () => poolDe('seed');

interface Propietario {
  tenantId: string;
  suscripcionId: string;
  correo: string;
  token: string;
}

/** Barbería con su propietario y la prueba terminando en `finPrueba`. */
async function barberia(finPrueba: Date): Promise<Propietario> {
  const b = await sembrarBarberia();
  const { suscripcionId } = await sembrarSuscripcion({ tenantId: b.tenantId, trialEndsAt: finPrueba });
  return {
    tenantId: b.tenantId,
    suscripcionId,
    correo: b.correo,
    token: await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO'),
  };
}

/** Un período pagado (con su pago aprobado) que empieza en `inicio`. */
async function periodoPagado(p: Propietario, inicio: Date): Promise<Date> {
  const { pagoId } = await sembrarPago({
    tenantId: p.tenantId,
    suscripcionId: p.suscripcionId,
    metodo: 'TRANSFERENCIA',
    estado: 'APROBADO',
    cubreDesde: inicio,
  });
  const fin = sumarUnMes(inicio);
  await seed().query(
    `INSERT INTO subscription_period (id, tenant_id, subscription_id, payment_id, plan_id, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [uuidv7(), p.tenantId, p.suscripcionId, pagoId, PLAN_BASICO, inicio, fin],
  );
  return fin;
}

/**
 * Las tareas recorren TODAS las barberías de la base compartida: las suscripciones que dejaron otros archivos
 * también vencen o están por terminar su prueba y producen avisos. Para que el lote de 100 de enviar-avisos tome los
 * de esta prueba, se descartan los pendientes de las demás barberías (los archivos corren de a uno).
 */
async function soloAvisosDe(tenants: string[]): Promise<void> {
  await seed().query(
    `UPDATE notification SET status = 'DESCARTADO', next_attempt_at = NULL, claimed_until = NULL
      WHERE status IN ('PENDIENTE', 'ENVIANDO') AND NOT (tenant_id = ANY($1))`,
    [tenants],
  );
}

async function eventosDe(tenantId: string, tipo: string): Promise<number> {
  const { rows } = await seed().query(
    'SELECT count(*)::int AS n FROM outbox_event WHERE tenant_id = $1 AND type = $2',
    [tenantId, tipo],
  );
  return rows[0].n;
}

/** Ningún dato de pago sensible en el mensaje (FR-039). */
function sinDatosDePago(mensaje: MensajeEnMailpit, prohibidos: string[]): void {
  for (const dato of prohibidos) expect(mensaje.texto).not.toContain(dato);
  expect(mensaje.texto).not.toMatch(/S\/\s?\d|céntimos|\b4900\b|tarjeta|cuenta bancaria/i);
}

describe('Avisos de suscripción al propietario (T124, US5)', () => {
  let mailpit: Mailpit;
  let proxy: ProxySmtp;
  let a: AppDePrueba;
  let b: AppDePrueba;

  const tarea = (prueba: AppDePrueba, nombre: string) => prueba.app.get(EjecutorTareas).ejecutarAhora(nombre);

  /** Despacha y, tras descartar los avisos de otras barberías, envía con una instancia. */
  async function despacharYEnviar(prueba: AppDePrueba, tenants: string[]): Promise<void> {
    await tarea(prueba, 'despachar-eventos');
    await soloAvisosDe(tenants);
    await tarea(prueba, 'enviar-avisos');
  }

  /** Las dos instancias a la vez: despacho y envío con el candado de las tareas, y envío sin él. */
  async function enviarConDosInstancias(tenants: string[]): Promise<void> {
    await Promise.all([tarea(a, 'despachar-eventos'), tarea(b, 'despachar-eventos')]);
    await soloAvisosDe(tenants);
    await Promise.all([
      tarea(a, 'enviar-avisos'),
      tarea(b, 'enviar-avisos'),
      enviarSinCandado(a),
      enviarSinCandado(b),
    ]);
  }

  const vencer = (prueba: AppDePrueba) => tarea(prueba, 'vencer-suscripciones');

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    proxy = await iniciarProxySmtp(mailpit);
    a = await appConCorreo(proxy);
    b = await appConCorreo(destinoDe(mailpit));
  });

  afterAll(async () => {
    await a.cerrar();
    await b.cerrar();
    await proxy.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  beforeEach(async () => {
    proxy.caido = false;
    await soloAvisosDe([]);
  });

  it('US5-1: prueba por terminar → un solo correo, aunque las dos instancias corran la tarea a la vez', async () => {
    const p = await barberia(new Date(Date.now() + 2 * DIA));
    // La tarea con el candado (en una) y el caso de uso sin él (en las dos a la vez): un solo evento.
    await Promise.all([
      tarea(a, 'avisar-fin-de-prueba'),
      a.app.get(AvisarFinDePrueba).ejecutar(),
      b.app.get(AvisarFinDePrueba).ejecutar(),
    ]);
    await b.app.get(AvisarFinDePrueba).ejecutar();
    expect(await eventosDe(p.tenantId, 'PruebaPorTerminar')).toBe(1);

    await enviarConDosInstancias([p.tenantId]);
    await enviarConDosInstancias([p.tenantId]);
    const correos = await esperarCorreos(mailpit, p.correo, 1);
    expect(correos).toHaveLength(1);
    expect(correos[0].asunto).toMatch(/tu prueba gratuita termina/i);
    expect(correos[0].texto).toMatch(/elegir un plan/i);
    expect(correos[0].contentType).toMatch(/^text\/plain/);
    expect(await avisosDe(p.tenantId)).toEqual([
      expect.objectContaining({
        kind: 'PRUEBA_POR_TERMINAR',
        recipient_kind: 'PROPIETARIO',
        channel_planned: 'CORREO',
        channel_used: 'CORREO',
        status: 'ENVIADO',
        appointment_id: null,
      }),
    ]);

    // Otra corrida días después (la prueba sigue por terminar): no vuelve a avisar.
    await a.app.get(AvisarFinDePrueba).ejecutar();
    expect(await eventosDe(p.tenantId, 'PruebaPorTerminar')).toBe(1);
  });

  it('US5-1: con un período siguiente pagado, o con más de 3 días de prueba, no hay aviso', async () => {
    const conSiguiente = await barberia(new Date(Date.now() + 2 * DIA));
    const { rows } = await seed().query('SELECT trial_ends_at FROM subscription WHERE id = $1', [
      conSiguiente.suscripcionId,
    ]);
    await periodoPagado(conSiguiente, rows[0].trial_ends_at);
    const lejos = await barberia(new Date(Date.now() + 3 * DIA + HORA));

    await a.app.get(AvisarFinDePrueba).ejecutar();
    expect(await eventosDe(conSiguiente.tenantId, 'PruebaPorTerminar')).toBe(0);
    expect(await eventosDe(lejos.tenantId, 'PruebaPorTerminar')).toBe(0);
  });

  it('US5-2 y US5-3: el paso a gracia y el vencimiento dejan un correo cada uno, con dos instancias', async () => {
    // Gracia: un período pagado que terminó hace una hora, sin el siguiente.
    const enGracia = await barberia(new Date(Date.now() - 40 * DIA));
    const inicio = new Date(Date.now() - 32 * DIA);
    const fin = await periodoPagado(enGracia, inicio);
    await seed().query(
      `UPDATE subscription SET status = 'ACTIVE', plan_id = $2, current_period_end = $3 WHERE id = $1`,
      [enGracia.suscripcionId, PLAN_BASICO, fin],
    );
    // Vencida: la prueba terminó hace una hora.
    const vencida = await barberia(new Date(Date.now() - HORA));

    await Promise.all([vencer(a), vencer(b)]);
    await Promise.all([vencer(a), vencer(b)]);
    const estados = await seed().query('SELECT id, status FROM subscription WHERE id = ANY($1)', [
      [enGracia.suscripcionId, vencida.suscripcionId],
    ]);
    expect(Object.fromEntries(estados.rows.map((f) => [f.id, f.status]))).toEqual({
      [enGracia.suscripcionId]: 'PAST_DUE',
      [vencida.suscripcionId]: 'EXPIRED',
    });
    expect(await eventosDe(enGracia.tenantId, 'SuscripcionEnGracia')).toBe(1);
    expect(await eventosDe(vencida.tenantId, 'SuscripcionVencida')).toBe(1);

    await enviarConDosInstancias([enGracia.tenantId, vencida.tenantId]);
    await enviarConDosInstancias([enGracia.tenantId, vencida.tenantId]);

    const gracia = await esperarCorreos(mailpit, enGracia.correo, 1);
    expect(gracia).toHaveLength(1);
    expect(gracia[0].asunto).toMatch(/período de gracia/i);
    expect(gracia[0].texto).toMatch(/hasta el/i);
    const vencio = await esperarCorreos(mailpit, vencida.correo, 1);
    expect(vencio).toHaveLength(1);
    expect(vencio[0].asunto).toMatch(/venció/i);
    expect(vencio[0].texto).toMatch(/ya no acepta reservas nuevas/i);
    expect(vencio[0].texto).toMatch(/al pagar/i);
  });

  it('US5-4: un pago aprobado y uno rechazado (en línea y por transferencia), un correo cada uno, sin datos de pago', async () => {
    const p = await barberia(new Date(Date.now() + 10 * DIA));
    const { rows } = await seed().query('SELECT trial_ends_at FROM subscription WHERE id = $1', [
      p.suscripcionId,
    ]);
    // En línea: rechazado y después aprobado (dos notificaciones del proveedor, repetidas por las dos instancias).
    const rechazado = await sembrarPago({ tenantId: p.tenantId, suscripcionId: p.suscripcionId });
    await Promise.all([
      notificar(a, { referencia: rechazado.referencia, estado: 'RECHAZADO' }).expect(200),
      notificar(b, { referencia: rechazado.referencia, estado: 'RECHAZADO' }).expect(200),
    ]);
    const aprobado = await sembrarPago({
      tenantId: p.tenantId,
      suscripcionId: p.suscripcionId,
      cubreDesde: rows[0].trial_ends_at,
    });
    await Promise.all([
      notificar(a, { referencia: aprobado.referencia }).expect(200),
      notificar(b, { referencia: aprobado.referencia }).expect(200),
    ]);
    expect((await filaDePago(aprobado.pagoId)).status).toBe('APROBADO');

    await enviarConDosInstancias([p.tenantId]);
    const correos = await esperarCorreos(mailpit, p.correo, 2);
    expect(correos).toHaveLength(2);
    const deRechazo = correos.find((c) => /rechaz/i.test(c.asunto)) as MensajeEnMailpit;
    const deAprobacion = correos.find((c) => /aprobado/i.test(c.asunto)) as MensajeEnMailpit;
    expect(deRechazo.texto).toMatch(/intentarlo de nuevo/i);
    expect(deAprobacion.texto).toMatch(/Plan:/);
    expect(deAprobacion.texto).toMatch(/Período: del .+ al .+/);
    for (const correo of correos) {
      sinDatosDePago(correo, [rechazado.referencia, aprobado.referencia, rechazado.pagoId, aprobado.pagoId]);
    }
    expect(await eventosDe(p.tenantId, 'PagoAprobado')).toBe(1);
    expect(await eventosDe(p.tenantId, 'PagoRechazado')).toBe(1);
  });

  it('US5-4: transferencia rechazada con motivo → un correo con el motivo, sin el número de operación', async () => {
    const p = await barberia(new Date(Date.now() + 10 * DIA));
    const { token } = await tokenPlataformaPara();
    const enRevision = await pagoEnRevision(a, p.token);
    await revisar(a, token, p.tenantId, enRevision.pagoId, {
      resultado: 'RECHAZADO',
      motivo: 'El voucher no se lee',
    }).expect(200);

    await enviarConDosInstancias([p.tenantId]);
    const correos = await esperarCorreos(mailpit, p.correo, 1);
    expect(correos).toHaveLength(1);
    expect(correos[0].asunto).toMatch(/rechaz/i);
    expect(correos[0].texto).toContain('Motivo: El voucher no se lee');
    sinDatosDePago(correos[0], [enRevision.numero, enRevision.referencia, enRevision.pagoId]);
  });

  it('US5-5: con el correo caído, el vencimiento se completa igual y el correo llega una vez al volver', async () => {
    const p = await barberia(new Date(Date.now() - HORA));
    proxy.caido = true;
    await vencer(a);
    const { rows } = await seed().query('SELECT status FROM subscription WHERE id = $1', [p.suscripcionId]);
    expect(rows[0].status).toBe('EXPIRED');

    // La instancia A (con el correo caído) intenta y falla: el aviso sigue pendiente, sin perderse.
    await despacharYEnviar(a, [p.tenantId]);
    expect(proxy.rechazadas()).toBeGreaterThan(0);
    expect(await avisosDe(p.tenantId)).toEqual([
      expect.objectContaining({ kind: 'SUSCRIPCION_VENCIDA', status: 'PENDIENTE', attempts: 1 }),
    ]);
    expect(await mailpit.mensajesPara(p.correo)).toHaveLength(0);

    // El correo vuelve: el siguiente intento lo envía, una sola vez.
    proxy.caido = false;
    await seed().query('UPDATE notification SET next_attempt_at = now() WHERE tenant_id = $1', [p.tenantId]);
    await enviarConDosInstancias([p.tenantId]);
    await enviarConDosInstancias([p.tenantId]);
    expect(await esperarCorreos(mailpit, p.correo, 1)).toHaveLength(1);
    expect(await avisosDe(p.tenantId)).toEqual([
      expect.objectContaining({ kind: 'SUSCRIPCION_VENCIDA', status: 'ENVIADO', attempts: 1 }),
    ]);
  });
});
