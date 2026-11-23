import { createHash } from 'node:crypto';
import { contrasenaCambiada } from '../../../src/modules/acceso-barberias/identidad/application/eventos-de-cuenta';
import { SolicitarEnlaceDeCuenta } from '../../../src/modules/acceso-barberias/identidad/application/solicitar-enlace-de-cuenta';
import type { PropositoEnlace } from '../../../src/modules/acceso-barberias/identidad/domain/enlace-de-cuenta';
import { BusDeEventos, TenantId, UnitOfWork } from '../../../src/shared';
import type { AppDePrueba } from '../../helpers/app';
import {
  appConCorreo,
  avisosDe,
  correrTareasDeAvisos,
  descartarAvisosDeOtrasPruebas,
  destinoDe,
  esperarCorreos,
  iniciarProxySmtp,
  type ProxySmtp,
} from '../../helpers/avisos';
import { sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T034 de 010 · Envío de los avisos de la cuenta (research R02; contracts/eventos-y-avisos.md de 010), por el mecanismo
// de 004 (salida de eventos, despacho y enviar-avisos) y con Mailpit:
// - el evento crea UN aviso para la CUENTA, siempre por correo;
// - al ENVIAR se emite el token y se guarda solo su hash; el enlace del correo es el de ese hash;
// - un reintento reemite (el token anterior deja de servir); un enlace que ya no sirve descarta el aviso;
// - con un canario: ningún token en outbox_event, en notification, en la auditoría ni en los registros;
// - con el correo caído, la solicitud responde igual, el aviso queda pendiente y sale al volver el canal (G2);
// - el correo llega al buzón dentro de 60 s (aserción con plazo, apoyo de SC-004).
//
// Los casos de uso que piden los enlaces (registro, reenvío y recuperación) llegan en las fases 4 y 5; aquí se usa la
// base común que ellos llamarán (SolicitarEnlaceDeCuenta), en una transacción con la barbería del enlace.

jest.setTimeout(240_000);

const URL_PUBLICA = (process.env.URL_PUBLICA ?? (process.env.FRONTEND_BASE_URL as string)).replace(
  /\/+$/,
  '',
);
const sha256 = (texto: string) => createHash('sha256').update(texto).digest('hex');

/** El token del enlace de un correo (va en el fragmento de la dirección). */
function tokenDe(texto: string, pagina: 'verificar' | 'restablecer'): string {
  const coincidencia = new RegExp(
    `${URL_PUBLICA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/${pagina}#([A-Za-z0-9_-]+)`,
  ).exec(texto);
  if (!coincidencia) throw new Error(`El correo no trae el enlace de /${pagina}`);
  return coincidencia[1];
}

async function escenario() {
  const barberia = await sembrarBarberia({ nombre: 'Barbería Huamanga' });
  const cliente = await sembrarCliente({ tenantId: barberia.tenantId });
  return { barberia, usuarioId: cliente.usuarioId as string, correo: cliente.correo as string };
}

function solicitar(prueba: AppDePrueba, tenantId: string, usuarioId: string, proposito: PropositoEnlace) {
  return prueba.app
    .get(UnitOfWork)
    .ejecutar(TenantId.de(tenantId), () =>
      prueba.app.get(SolicitarEnlaceDeCuenta).ejecutar(usuarioId, proposito),
    );
}

async function hashDelEnlace(enlaceId: string): Promise<string | null> {
  const { rows } = await poolDe('seed').query('SELECT token_hash FROM account_link WHERE id = $1', [
    enlaceId,
  ]);
  return rows[0].token_hash;
}

/** Todo lo que sale por los registros mientras corre `fn` (stdout y stderr, donde escribe el Logger de Nest). */
async function capturarRegistros(fn: () => Promise<void>): Promise<string> {
  const salida = jest.spyOn(process.stdout, 'write');
  const errores = jest.spyOn(process.stderr, 'write');
  try {
    await fn();
    return [...salida.mock.calls, ...errores.mock.calls].map((llamada) => String(llamada[0])).join('');
  } finally {
    salida.mockRestore();
    errores.mockRestore();
  }
}

describe('Avisos de la cuenta (T034 de 010)', () => {
  let mailpit: Mailpit;
  let prueba: AppDePrueba;

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    prueba = await appConCorreo(destinoDe(mailpit));
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await prueba.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('verificar: UN aviso a la CUENTA por correo; el token se emite al enviar y en la base queda solo su hash', async () => {
    const { barberia, usuarioId, correo } = await escenario();
    const inicio = Date.now();
    const enlace = await solicitar(prueba, barberia.tenantId, usuarioId, 'VERIFICAR_CORREO');
    // Antes de enviar, el enlace no tiene token.
    expect(await hashDelEnlace(enlace.id)).toBeNull();

    await correrTareasDeAvisos(prueba);
    const correos = await esperarCorreos(mailpit, correo, 1);
    // SC-004: el correo llega al buzón dentro de 60 s desde la solicitud.
    expect(Date.now() - inicio).toBeLessThan(60_000);
    expect(correos).toHaveLength(1);
    const [mensaje] = correos;
    expect(mensaje.asunto).toMatch(/verifica tu correo/i);
    expect(mensaje.texto).toContain('Barbería Huamanga');
    expect(mensaje.texto).toMatch(/24 horas/);
    expect(mensaje.texto).not.toContain(correo);

    const token = tokenDe(mensaje.texto, 'verificar');
    expect(await hashDelEnlace(enlace.id)).toBe(sha256(token));

    const avisos = await avisosDe(barberia.tenantId);
    expect(
      avisos.map((a) => [a.kind, a.recipient_kind, a.recipient_ref, a.channel_planned, a.status]),
    ).toEqual([['VERIFICAR_CORREO', 'CUENTA', usuarioId, 'CORREO', 'ENVIADO']]);
  });

  it('recuperar: el correo lleva /restablecer y la vigencia de 1 hora', async () => {
    const { barberia, usuarioId, correo } = await escenario();
    const enlace = await solicitar(prueba, barberia.tenantId, usuarioId, 'RECUPERAR_CONTRASENA');
    await correrTareasDeAvisos(prueba);
    const [mensaje] = await esperarCorreos(mailpit, correo, 1);
    expect(mensaje.texto).toMatch(/1 hora/);
    expect(await hashDelEnlace(enlace.id)).toBe(sha256(tokenDe(mensaje.texto, 'restablecer')));
  });

  it('canario: el token no queda en outbox_event, notification, la auditoría ni los registros', async () => {
    const { barberia, usuarioId, correo } = await escenario();
    const registros = await capturarRegistros(async () => {
      await solicitar(prueba, barberia.tenantId, usuarioId, 'VERIFICAR_CORREO');
      await correrTareasDeAvisos(prueba);
    });
    const [mensaje] = await esperarCorreos(mailpit, correo, 1);
    const token = tokenDe(mensaje.texto, 'verificar');
    expect(token.length).toBeGreaterThanOrEqual(40);

    const tablas = await poolDe('seed').query(
      `SELECT (SELECT coalesce(string_agg(row_to_json(o)::text, ''), '') FROM outbox_event o WHERE o.tenant_id = $1)
           || (SELECT coalesce(string_agg(row_to_json(n)::text, ''), '') FROM notification n WHERE n.tenant_id = $1)
           || (SELECT coalesce(string_agg(row_to_json(a)::text, ''), '') FROM audit_log a WHERE a.tenant_id = $1)
           AS todo`,
      [barberia.tenantId],
    );
    expect(tablas.rows[0].todo).not.toContain(token);
    expect(tablas.rows[0].todo).not.toContain(sha256(token));
    expect(registros).not.toContain(token);
    // El evento lleva solo el id del enlace, el propósito, la cuenta y el vencimiento.
    const { rows } = await poolDe('seed').query(
      `SELECT payload FROM outbox_event WHERE tenant_id = $1 AND type = 'EnlaceDeCuentaSolicitado'`,
      [barberia.tenantId],
    );
    expect(Object.keys(rows[0].payload).sort()).toEqual(['enlaceId', 'proposito', 'usuarioId', 'venceEn']);
  });

  it('un enlace que ya no sirve al enviar (anulado) descarta el aviso sin mandar nada', async () => {
    const { barberia, usuarioId, correo } = await escenario();
    const enlace = await solicitar(prueba, barberia.tenantId, usuarioId, 'VERIFICAR_CORREO');
    await poolDe('seed').query('UPDATE account_link SET revoked_at = now() WHERE id = $1', [enlace.id]);
    await correrTareasDeAvisos(prueba);
    expect((await avisosDe(barberia.tenantId)).map((a) => a.status)).toEqual(['DESCARTADO']);
    expect(await hashDelEnlace(enlace.id)).toBeNull();
    expect(await esperarCorreos(mailpit, correo, 1, 1_500)).toEqual([]);
  });

  it('pedir otro antes de enviar anula el primero: sale un solo correo, con el enlace nuevo', async () => {
    const { barberia, usuarioId, correo } = await escenario();
    const primero = await solicitar(prueba, barberia.tenantId, usuarioId, 'VERIFICAR_CORREO');
    const segundo = await solicitar(prueba, barberia.tenantId, usuarioId, 'VERIFICAR_CORREO');
    await correrTareasDeAvisos(prueba);
    const correos = await esperarCorreos(mailpit, correo, 1);
    await new Promise((resolver) => setTimeout(resolver, 1_000));
    expect(await mailpit.mensajesPara(correo)).toHaveLength(1);
    expect(await hashDelEnlace(segundo.id)).toBe(sha256(tokenDe(correos[0].texto, 'verificar')));
    expect(await hashDelEnlace(primero.id)).toBeNull();
    // Según si el primer evento ya se había despachado, su aviso existe y se descartó, o el evento quedó anulado por la
    // clave de reemplazo y no hubo aviso. En los dos casos, un solo aviso enviado.
    const estados = (await avisosDe(barberia.tenantId)).map((a) => a.status);
    expect(estados.filter((estado) => estado === 'ENVIADO')).toHaveLength(1);
    expect(estados.every((estado) => estado === 'ENVIADO' || estado === 'DESCARTADO')).toBe(true);
  });

  it('contraseña cambiada: UN aviso a la cuenta, con la fecha del cambio y sin enlace', async () => {
    const { barberia, usuarioId, correo } = await escenario();
    await prueba.app
      .get(UnitOfWork)
      .ejecutar(TenantId.de(barberia.tenantId), () =>
        prueba.app
          .get(BusDeEventos)
          .publicar(contrasenaCambiada(usuarioId, new Date('2026-11-23T15:00:00Z'))),
      );
    await correrTareasDeAvisos(prueba);
    const [mensaje] = await esperarCorreos(mailpit, correo, 1);
    expect(mensaje.asunto).toMatch(/tu contraseña cambió/i);
    expect(mensaje.texto).toMatch(/23 de noviembre de 2026, a las 10:00/);
    expect(mensaje.texto).not.toMatch(/#/);
    expect((await avisosDe(barberia.tenantId)).map((a) => [a.kind, a.recipient_kind, a.status])).toEqual([
      ['CONTRASENA_CAMBIADA', 'CUENTA', 'ENVIADO'],
    ]);
  });

  describe('con el correo caído (G2)', () => {
    let proxy: ProxySmtp;
    let conProxy: AppDePrueba;

    beforeAll(async () => {
      proxy = await iniciarProxySmtp(mailpit);
      conProxy = await appConCorreo(proxy);
    });

    afterAll(async () => {
      await conProxy.cerrar();
      await proxy.cerrar();
    });

    it('la solicitud responde igual; el aviso queda pendiente y sale al volver, con un token REEMITIDO', async () => {
      const { barberia, usuarioId, correo } = await escenario();
      proxy.caido = true;
      const enlace = await solicitar(conProxy, barberia.tenantId, usuarioId, 'VERIFICAR_CORREO');
      expect(proxy.rechazadas()).toBe(0);

      await correrTareasDeAvisos(conProxy);
      expect(proxy.rechazadas()).toBeGreaterThan(0);
      expect((await avisosDe(barberia.tenantId)).map((a) => a.status)).toEqual(['PENDIENTE']);
      // El intento fallido ya emitió un token (y guardó su hash).
      const primerHash = await hashDelEnlace(enlace.id);
      expect(primerHash).toMatch(/^[0-9a-f]{64}$/);

      proxy.caido = false;
      // Pasada la pausa del circuito del correo (30 s), la tarea lo envía, una vez.
      await new Promise((resolver) => setTimeout(resolver, 31_000));
      await poolDe('seed').query('UPDATE notification SET next_attempt_at = now() WHERE tenant_id = $1', [
        barberia.tenantId,
      ]);
      await correrTareasDeAvisos(conProxy);
      await correrTareasDeAvisos(conProxy);

      expect((await avisosDe(barberia.tenantId)).map((a) => a.status)).toEqual(['ENVIADO']);
      const correos = await esperarCorreos(mailpit, correo, 1);
      expect(correos).toHaveLength(1);
      const hashFinal = await hashDelEnlace(enlace.id);
      expect(hashFinal).toBe(sha256(tokenDe(correos[0].texto, 'verificar')));
      // Reemitido: el token del intento fallido ya no sirve.
      expect(hashFinal).not.toBe(primerHash);
    });
  });
});
