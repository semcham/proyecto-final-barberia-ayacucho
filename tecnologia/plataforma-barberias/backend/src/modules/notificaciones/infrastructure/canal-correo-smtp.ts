import { Logger } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { type Clock, Interruptor } from '../../../shared';
import {
  CanalNoDisponible,
  DestinatarioInvalido,
  type EnvioAceptado,
  type MensajeSaliente,
  NotificationChannel,
} from '../application/ports/notification-channel';

// T033 de 004 · Adaptador de correo por SMTP con nodemailer (ADR-026; contracts/notification-channel.md §2):
// Mailpit en desarrollo y pruebas; el SMTP de producción, por verificar.
// - Texto simple en UTF-8; el Message-ID sale de la clave de idempotencia (el id del aviso), así un reenvío
//   tras una caída lleva el mismo identificador (SMTP no deduplica: límite documentado en ADR-025).
// - Tiempo límite por envío (CORREO_TIEMPO_LIMITE_MS, 5 s) y el Interruptor de M06: 5 fallos en 60 s lo abren
//   y mientras está abierto se responde CanalNoDisponible sin llamar al servidor.
// - Un rechazo permanente del destinatario (5xx en RCPT) es DestinatarioInvalido y no cuenta como fallo del
//   canal. Un rechazo temporal (4xx) es CanalNoDisponible.
// - Nunca registra el texto ni el destino: solo códigos.

export type ModoTls = 'no' | 'starttls' | 'implicito';

export interface OpcionesCorreoSmtp {
  host: string;
  puerto: number;
  tls: ModoTls;
  usuario?: string;
  clave?: string;
  /** Dirección del remitente; su dominio forma el Message-ID. */
  remitente: string;
  tiempoLimiteMs: number;
}

type Motivo = 'TIEMPO_AGOTADO' | 'SIN_RESPUESTA' | 'RECHAZO_TEMPORAL';
type Resultado = { tipo: 'aceptado'; referencia: string } | { tipo: 'destinatario-invalido' };

const CORREO = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const CLAVE = /^[A-Za-z0-9-]{1,64}$/;
/** Margen para que el corte propio llegue aunque nodemailer tarde en cerrar el socket. */
const MARGEN_MS = 100;

interface ErrorSmtp {
  code?: string;
  responseCode?: number;
  command?: string;
}

export class CanalCorreoSmtp extends NotificationChannel {
  readonly canal = 'CORREO' as const;
  private readonly logger = new Logger('CanalCorreo');
  private readonly interruptor: Interruptor;
  private readonly dominio: string;

  constructor(
    private readonly opciones: OpcionesCorreoSmtp,
    reloj: Clock,
  ) {
    super();
    this.dominio = opciones.remitente.split('@')[1] ?? 'localhost';
    this.interruptor = new Interruptor({
      fallosParaAbrir: 5,
      ventanaMs: 60_000,
      pausaMs: 30_000,
      reloj,
      alAbrir: () => this.logger.warn('CORREO_NO_DISPONIBLE: el servidor SMTP no responde; circuito abierto'),
      alRecuperar: () => this.logger.log('CORREO_RECUPERADO'),
    });
  }

  async enviar(mensaje: MensajeSaliente): Promise<EnvioAceptado> {
    if (!CORREO.test(mensaje.destino) || mensaje.destino.length > 254) throw new DestinatarioInvalido();
    if (!CLAVE.test(mensaje.claveIdempotencia)) throw new Error('La clave de idempotencia no es válida');

    let motivo: Motivo | null = null;
    let llamado = false;
    const resultado = await this.interruptor.ejecutar<Resultado>(
      async () => {
        llamado = true;
        try {
          return await this.enviarPorSmtp(mensaje);
        } catch (error) {
          motivo = this.clasificar(error);
          throw error;
        }
      },
      () => {
        // Sin llamar al servidor (circuito abierto, o una prueba en curso en semiabierto): CIRCUITO_ABIERTO, que
        // la política de reintentos no cuenta como intento (004, fase 3).
        throw new CanalNoDisponible(llamado ? (motivo ?? 'SIN_RESPUESTA') : 'CIRCUITO_ABIERTO');
      },
    );
    if (resultado.tipo === 'destinatario-invalido') throw new DestinatarioInvalido();
    return { referencia: resultado.referencia };
  }

  private async enviarPorSmtp(mensaje: MensajeSaliente): Promise<Resultado> {
    const { host, puerto, tls, usuario, clave, remitente, tiempoLimiteMs } = this.opciones;
    const transporte = createTransport({
      host,
      port: puerto,
      secure: tls === 'implicito',
      requireTLS: tls === 'starttls',
      ignoreTLS: tls === 'no',
      auth: usuario && clave ? { user: usuario, pass: clave } : undefined,
      connectionTimeout: tiempoLimiteMs,
      greetingTimeout: tiempoLimiteMs,
      socketTimeout: tiempoLimiteMs,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    let temporizador: NodeJS.Timeout | undefined;
    const corte = new Promise<never>((_, rechazar) => {
      temporizador = setTimeout(
        () => rechazar(Object.assign(new Error('Tiempo agotado'), { code: 'ETIMEDOUT' })),
        tiempoLimiteMs + MARGEN_MS,
      );
    });
    try {
      const info = await Promise.race([
        transporte.sendMail({
          from: remitente,
          to: mensaje.destino,
          subject: mensaje.asunto ?? '',
          text: mensaje.texto,
          messageId: `<${mensaje.claveIdempotencia}@${this.dominio}>`,
        }),
        corte,
      ]);
      return { tipo: 'aceptado', referencia: String(info.messageId) };
    } catch (error) {
      const { responseCode, command } = (error ?? {}) as ErrorSmtp;
      // Rechazo permanente del destinatario: el servidor respondió bien, así que no cuenta para el interruptor.
      if (responseCode !== undefined && responseCode >= 500 && /RCPT/i.test(command ?? '')) {
        return { tipo: 'destinatario-invalido' };
      }
      throw error;
    } finally {
      clearTimeout(temporizador);
      transporte.close();
    }
  }

  /** Solo un código: el mensaje de nodemailer puede repetir el destino. */
  private clasificar(error: unknown): Motivo {
    const { code, responseCode } = (error ?? {}) as ErrorSmtp;
    if (code === 'ETIMEDOUT') return 'TIEMPO_AGOTADO';
    if (responseCode !== undefined && responseCode >= 400 && responseCode < 500) return 'RECHAZO_TEMPORAL';
    return 'SIN_RESPUESTA';
  }
}
