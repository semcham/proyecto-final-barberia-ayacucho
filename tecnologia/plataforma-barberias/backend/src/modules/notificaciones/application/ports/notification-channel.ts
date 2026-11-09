import { ErrorDeAplicacion } from '../../../../shared';

// T032 de 004 · Puerto de envío de M05 (ADR-013 y ADR-026; contracts/notification-channel.md §1). Los casos de
// uso de M05 envían SOLO por este puerto (regla canal-solo-por-puerto de PR14): el correo por SMTP y el
// WhatsApp simulado son adaptadores intercambiables, y un proveedor real será otro adaptador que pase la misma
// suite de contrato.

export type CanalDeAviso = 'CORREO' | 'WHATSAPP';

export interface MensajeSaliente {
  /** Correo o número del destinatario. Ningún adaptador lo registra. */
  destino: string;
  asunto?: string;
  /** Texto simple (línea de corte 1). Ningún adaptador lo registra. */
  texto: string;
  /** El id del aviso: Message-ID en el correo e Idempotency-Key en WhatsApp. */
  claveIdempotencia: string;
}

export interface EnvioAceptado {
  /** Identificador que devuelve el canal (Message-ID, id del mensaje de WhatsApp). */
  referencia: string;
}

/**
 * Falla temporal: tiempo agotado, red, 5xx, 429, rechazo temporal o circuito abierto. El aviso se reintenta.
 */
export class CanalNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'CANAL_NO_DISPONIBLE';

  constructor(motivo: 'TIEMPO_AGOTADO' | 'SIN_RESPUESTA' | 'RECHAZO_TEMPORAL' | 'CIRCUITO_ABIERTO') {
    super(`El canal de aviso no está disponible (${motivo})`);
  }
}

/** Falla permanente: el canal rechazó el destino. El aviso no se reintenta. */
export class DestinatarioInvalido extends ErrorDeAplicacion {
  readonly codigo = 'DESTINATARIO_INVALIDO';

  constructor() {
    super('El canal rechazó el destinatario');
  }
}

export abstract class NotificationChannel {
  abstract readonly canal: CanalDeAviso;

  /** Envía el mensaje con el tiempo límite y el interruptor del adaptador. */
  abstract enviar(mensaje: MensajeSaliente): Promise<EnvioAceptado>;
}
