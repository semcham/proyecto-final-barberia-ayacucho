import { connect, createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { EnviarAvisos } from '../../src/modules/notificaciones';
import { EjecutorTareas } from '../../src/shared';
import { type AppDePrueba, crearApp } from './app';
import type { Mailpit, MensajeEnMailpit } from './mailpit';
import { poolDe } from './test-db';

// Ayudantes de las pruebas de avisos de 004 (fase 3, US2): la aplicación apuntada a un buzón, las corridas de
// las tareas y la lectura de la tabla notification (sin RLS, con el pool de siembra).

export interface DestinoSmtp {
  host: string;
  puerto: number;
}

/** La aplicación completa con el correo apuntado a `smtp` (Mailpit o el proxy de abajo). */
export function appConCorreo(smtp: DestinoSmtp, opciones: { escuchar?: boolean } = {}): Promise<AppDePrueba> {
  return crearApp({
    entorno: { SMTP_HOST: smtp.host, SMTP_PUERTO: String(smtp.puerto) },
    escuchar: opciones.escuchar,
  });
}

export const destinoDe = (mailpit: Mailpit): DestinoSmtp => ({
  host: mailpit.host,
  puerto: mailpit.puertoSmtp,
});

/** Una corrida de despachar-eventos y otra de enviar-avisos, con el candado de las tareas (ADR-024). */
export async function correrTareasDeAvisos(prueba: AppDePrueba): Promise<void> {
  const ejecutor = prueba.app.get(EjecutorTareas);
  await ejecutor.ejecutarAhora('despachar-eventos');
  await ejecutor.ejecutarAhora('enviar-avisos');
}

/** Una corrida de enviar-avisos SIN el candado: para probar que dos réplicas a la vez no duplican. */
export function enviarSinCandado(prueba: AppDePrueba) {
  return prueba.app.get(EnviarAvisos).ejecutar();
}

export interface FilaAviso {
  id: string;
  event_id: string;
  kind: string;
  recipient_kind: string;
  recipient_ref: string;
  appointment_id: string | null;
  channel_planned: string;
  channel_used: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  sent_at: Date | null;
}

export async function avisosDe(tenantId: string): Promise<FilaAviso[]> {
  const { rows } = await poolDe('seed').query<FilaAviso>(
    `SELECT id, event_id, kind, recipient_kind, recipient_ref, appointment_id, channel_planned, channel_used,
            status, attempts, last_error, sent_at
       FROM notification WHERE tenant_id = $1 ORDER BY created_at, recipient_kind`,
    [tenantId],
  );
  return rows;
}

/** Espera (hasta `ms`) a que el buzón tenga `n` mensajes para `destino`, y los devuelve. */
export async function esperarCorreos(
  mailpit: Mailpit,
  destino: string,
  n: number,
  ms = 10_000,
): Promise<MensajeEnMailpit[]> {
  const limite = Date.now() + ms;
  let mensajes = await mailpit.mensajesPara(destino);
  while (mensajes.length < n && Date.now() < limite) {
    await new Promise((resolver) => setTimeout(resolver, 200));
    mensajes = await mailpit.mensajesPara(destino);
  }
  return mensajes;
}

/**
 * Proxy TCP delante de Mailpit que se puede "apagar": caído, corta cada conexión al recibirla (como un servidor
 * SMTP detenido); en marcha, la reenvía a Mailpit. Así el correo "vuelve" sin recrear el contenedor.
 */
export interface ProxySmtp extends DestinoSmtp {
  caido: boolean;
  /** Conexiones recibidas mientras estaba caído. */
  rechazadas(): number;
  cerrar(): Promise<void>;
}

export async function iniciarProxySmtp(mailpit: Mailpit): Promise<ProxySmtp> {
  const estado = { caido: false, rechazadas: 0 };
  const sockets = new Set<Socket>();
  const servidor: Server = createServer((entrante) => {
    sockets.add(entrante);
    entrante.on('close', () => sockets.delete(entrante));
    entrante.on('error', () => undefined);
    if (estado.caido) {
      estado.rechazadas += 1;
      entrante.destroy();
      return;
    }
    const saliente = connect(mailpit.puertoSmtp, mailpit.host);
    sockets.add(saliente);
    saliente.on('close', () => sockets.delete(saliente));
    saliente.on('error', () => entrante.destroy());
    entrante.pipe(saliente).pipe(entrante);
  });
  await new Promise<void>((resolver) => servidor.listen(0, '127.0.0.1', resolver));
  return {
    host: '127.0.0.1',
    puerto: (servidor.address() as AddressInfo).port,
    get caido() {
      return estado.caido;
    },
    set caido(valor: boolean) {
      estado.caido = valor;
    },
    rechazadas: () => estado.rechazadas,
    cerrar: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolver) => servidor.close(() => resolver()));
    },
  };
}
