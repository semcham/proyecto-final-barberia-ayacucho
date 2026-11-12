import { randomUUID } from 'node:crypto';

// Estado en memoria del simulador de WhatsApp (004, contracts/notification-channel.md §3): los mensajes aceptados,
// para que las pruebas y la demostración los consulten, y la idempotencia por Idempotency-Key. Se pierde al
// reiniciar: no hay ninguna base ni registro en disco (y nunca datos reales: solo números y textos de prueba).

export interface MensajeSimulado {
  id: string;
  para: string;
  texto: string;
  claveIdempotencia: string;
  /** Si la solicitud declaró `charset=utf-8` (la suite de contrato comprueba tildes y eñe). */
  charsetUtf8: boolean;
  recibidoEn: string;
}

export class EstadoSimuladorWhatsapp {
  private readonly mensajes: MensajeSimulado[] = [];
  private readonly porClave = new Map<string, MensajeSimulado>();

  /** Guarda el mensaje; con una clave ya vista devuelve el mensaje anterior sin guardar otro. */
  aceptar(datos: Omit<MensajeSimulado, 'id' | 'recibidoEn'>): {
    mensaje: MensajeSimulado;
    repetido: boolean;
  } {
    const previo = this.porClave.get(datos.claveIdempotencia);
    if (previo) return { mensaje: previo, repetido: true };
    const mensaje: MensajeSimulado = {
      ...datos,
      id: `wa_${randomUUID()}`,
      recibidoEn: new Date().toISOString(),
    };
    this.mensajes.push(mensaje);
    this.porClave.set(datos.claveIdempotencia, mensaje);
    return { mensaje, repetido: false };
  }

  para(numero: string): MensajeSimulado[] {
    return this.mensajes.filter((m) => m.para === numero);
  }

  todos(): MensajeSimulado[] {
    return [...this.mensajes];
  }

  reiniciar(): void {
    this.mensajes.length = 0;
    this.porClave.clear();
  }
}
