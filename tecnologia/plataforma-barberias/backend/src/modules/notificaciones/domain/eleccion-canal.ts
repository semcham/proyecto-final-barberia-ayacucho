// T069 de 004 · Elección del canal de un aviso (research R12). Regla pura de M05. En la fase 3 siempre es el
// correo; en la fase 5 se agrega WhatsApp (solo con el canal WHATSAPP y consentimiento vigente para el número).

/** Contacto del destinatario leído de M01 al enviar; null si ya no existe en la barbería. */
export interface ContactoDelDestinatario {
  correo: string | null;
  canal: 'CORREO';
}

export type CanalElegido = { canal: 'CORREO'; destino: string } | { descartar: 'SIN_CANAL' };

export function elegirCanal(contacto: ContactoDelDestinatario | null): CanalElegido {
  // Sin correo (cliente presencial que no lo dio, o un destinatario que ya no está): no hay por dónde avisar
  // (FR-015). El aviso queda DESCARTADO con el motivo SIN_CANAL.
  if (!contacto?.correo) return { descartar: 'SIN_CANAL' };
  return { canal: 'CORREO', destino: contacto.correo };
}
