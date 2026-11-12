// T069/T119 de 004 · Elección del canal de un aviso (research R12; FR-015, FR-019, FR-020). Regla pura de M05:
// - WhatsApp SOLO si el canal elegido es WhatsApp, hay número y el consentimiento está vigente para ese número
//   (lo decide M01 al enviar: un retiro intermedio se respeta);
// - si no, correo; sin correo (cliente presencial que no lo dio), el aviso se descarta (SIN_CANAL);
// - respaldo: tras 3 fallos de WhatsApp, con su circuito abierto o con el número rechazado, el MISMO aviso sale por
//   correo una sola vez (ENVIADO_RESPALDO).

/** Intentos de WhatsApp antes de pasar al correo de respaldo (R13). */
export const INTENTOS_WHATSAPP = 3;

/** Contacto del destinatario leído de M01 al enviar; null si ya no existe en la barbería. */
export interface ContactoDelDestinatario {
  correo: string | null;
  canal: 'CORREO' | 'WHATSAPP';
  numeroWhatsapp?: string | null;
  /** Consentimiento vigente para `numeroWhatsapp` en esta barbería. */
  consentimientoVigente?: boolean;
}

export type CanalElegido =
  | { canal: 'WHATSAPP'; destino: string }
  | { canal: 'CORREO'; destino: string; respaldo?: true }
  | { descartar: 'SIN_CANAL' };

export function elegirCanal(
  contacto: ContactoDelDestinatario | null,
  opciones: { respaldo?: boolean } = {},
): CanalElegido {
  if (!contacto) return { descartar: 'SIN_CANAL' };
  const conWhatsapp =
    contacto.canal === 'WHATSAPP' && contacto.consentimientoVigente === true && !!contacto.numeroWhatsapp;
  if (conWhatsapp && !opciones.respaldo)
    return { canal: 'WHATSAPP', destino: contacto.numeroWhatsapp as string };
  if (!contacto.correo) return { descartar: 'SIN_CANAL' };
  // Es respaldo solo si de verdad se dejó WhatsApp por sus fallos.
  return conWhatsapp
    ? { canal: 'CORREO', destino: contacto.correo, respaldo: true }
    : { canal: 'CORREO', destino: contacto.correo };
}

/**
 * Tras un fallo de WhatsApp (`intentos` ya contando este): ¿se pasa al correo de respaldo ahora? Con el circuito
 * abierto o el número rechazado, de inmediato; si no, al tercer intento fallido.
 */
export function debeRespaldar(
  intentos: number,
  fallo: 'TEMPORAL' | 'PERMANENTE' | 'CIRCUITO_ABIERTO',
): boolean {
  return fallo !== 'TEMPORAL' || intentos >= INTENTOS_WHATSAPP;
}
