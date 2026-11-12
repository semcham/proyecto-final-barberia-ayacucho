import { Logger } from '@nestjs/common';
import { type Clock, Interruptor } from '../../../shared';
import {
  CanalNoDisponible,
  DestinatarioInvalido,
  type EnvioAceptado,
  type MensajeSaliente,
  NotificationChannel,
} from '../application/ports/notification-channel';

// T114 de 004 · Adaptador de WhatsApp contra el simulador por HTTP (ADR-026; contracts/notification-channel.md §2).
// No hay proveedor real ni credenciales reales (R17): un proveedor contratado será otro adaptador que pase la misma
// suite de contrato.
// - POST {urlBase}/mensajes con `Authorization: Bearer WHATSAPP_TOKEN` y `Idempotency-Key` (el id del aviso): un
//   reenvío tras una caída no duplica el mensaje.
// - Tiempo límite por envío (WHATSAPP_TIEMPO_LIMITE_MS, 3 s) y el Interruptor de M06: 5 fallos en 60 s lo abren y,
//   abierto, se responde CanalNoDisponible('CIRCUITO_ABIERTO') sin llamar (el aviso pasa al correo de respaldo).
// - 400/422 (número rechazado) es DestinatarioInvalido y no cuenta para el circuito; 429, 5xx, red o tiempo
//   agotado son CanalNoDisponible.
// - Nunca registra el texto ni el número: solo códigos.

export interface OpcionesWhatsappSimulado {
  urlBase: string;
  token: string;
  tiempoLimiteMs: number;
}

type Motivo = 'TIEMPO_AGOTADO' | 'SIN_RESPUESTA' | 'RECHAZO_TEMPORAL';
type Resultado = { tipo: 'aceptado'; referencia: string } | { tipo: 'destinatario-invalido' };

/** El mismo formato que acepta la preferencia del cliente (data-model §2.1). */
const NUMERO = /^\+?[0-9 ]{6,20}$/;
const CLAVE = /^[A-Za-z0-9-]{1,64}$/;

class FalloHttp extends Error {
  constructor(readonly motivo: Motivo) {
    super(motivo);
  }
}

export class CanalWhatsappSimulado extends NotificationChannel {
  readonly canal = 'WHATSAPP' as const;
  private readonly logger = new Logger('CanalWhatsapp');
  private readonly interruptor: Interruptor;
  private readonly url: string;

  constructor(
    private readonly opciones: OpcionesWhatsappSimulado,
    reloj: Clock,
  ) {
    super();
    this.url = `${opciones.urlBase.replace(/\/+$/, '')}/mensajes`;
    this.interruptor = new Interruptor({
      fallosParaAbrir: 5,
      ventanaMs: 60_000,
      pausaMs: 30_000,
      reloj,
      alAbrir: () => this.logger.warn('WHATSAPP_NO_DISPONIBLE: el canal no responde; circuito abierto'),
      alRecuperar: () => this.logger.log('WHATSAPP_RECUPERADO'),
    });
  }

  async enviar(mensaje: MensajeSaliente): Promise<EnvioAceptado> {
    if (!NUMERO.test(mensaje.destino)) throw new DestinatarioInvalido();
    if (!CLAVE.test(mensaje.claveIdempotencia)) throw new Error('La clave de idempotencia no es válida');

    let motivo: Motivo | null = null;
    let llamado = false;
    const resultado = await this.interruptor.ejecutar<Resultado>(
      async () => {
        llamado = true;
        try {
          return await this.enviarPorHttp(mensaje);
        } catch (error) {
          motivo = error instanceof FalloHttp ? error.motivo : this.clasificar(error);
          throw error;
        }
      },
      () => {
        throw new CanalNoDisponible(llamado ? (motivo ?? 'SIN_RESPUESTA') : 'CIRCUITO_ABIERTO');
      },
    );
    if (resultado.tipo === 'destinatario-invalido') throw new DestinatarioInvalido();
    return { referencia: resultado.referencia };
  }

  private async enviarPorHttp(mensaje: MensajeSaliente): Promise<Resultado> {
    const respuesta = await fetch(this.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.opciones.token}`,
        'Idempotency-Key': mensaje.claveIdempotencia,
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ para: mensaje.destino, texto: mensaje.texto }),
      signal: AbortSignal.timeout(this.opciones.tiempoLimiteMs),
    });
    // Rechazo permanente del número: el canal respondió bien, así que no cuenta para el interruptor.
    if (respuesta.status === 400 || respuesta.status === 422) {
      await respuesta.body?.cancel();
      return { tipo: 'destinatario-invalido' };
    }
    if (!respuesta.ok) {
      await respuesta.body?.cancel();
      throw new FalloHttp(respuesta.status === 429 ? 'RECHAZO_TEMPORAL' : 'SIN_RESPUESTA');
    }
    const cuerpo = (await respuesta.json()) as { id?: unknown };
    if (typeof cuerpo.id !== 'string') throw new FalloHttp('SIN_RESPUESTA');
    return { tipo: 'aceptado', referencia: cuerpo.id };
  }

  /** Solo un código: el mensaje del error puede repetir la dirección. */
  private clasificar(error: unknown): Motivo {
    const nombre = (error as { name?: string } | null)?.name;
    return nombre === 'TimeoutError' || nombre === 'AbortError' ? 'TIEMPO_AGOTADO' : 'SIN_RESPUESTA';
  }
}

/**
 * Sin proveedor (WHATSAPP_PROVEEDOR=ninguno, R17): WhatsApp no está disponible y el aviso pasa al correo de
 * respaldo de inmediato, como con el circuito abierto.
 */
export class CanalWhatsappNoDisponible extends NotificationChannel {
  readonly canal = 'WHATSAPP' as const;
  enviar(): Promise<EnvioAceptado> {
    return Promise.reject(new CanalNoDisponible('CIRCUITO_ABIERTO'));
  }
}
