// T116 de 004 · Texto del consentimiento para recibir avisos por WhatsApp (FR-017; research R18), copiado de
// specs/004-notificaciones-reprogramacion/contracts/texto-consentimiento-whatsapp.md.
//
// TEXTO BASE, POR VALIDAR CON ASESORÍA LEGAL: no se afirma que cumpla la Ley N.° 29733 ni su reglamento.
//
// Un texto nuevo lleva una versión nueva. Cada aceptación guarda la versión que vio el cliente (whatsapp_consent),
// y la API entrega siempre la vigente. `{nombre de la barbería}` lo completa la API; `{número}`, la interfaz con el
// número que escribe el cliente.

export const DOCUMENTO_CONSENTIMIENTO_WHATSAPP = 'WHATSAPP';
export const VERSION_TEXTO_WHATSAPP = '2026-11';

export const TEXTO_CONSENTIMIENTO_WHATSAPP = [
  'Avisos por WhatsApp',
  '',
  'Acepto que {nombre de la barbería} me envíe por WhatsApp, al número {número}, los avisos de mis citas:',
  '- la confirmación cuando reservo;',
  '- el aviso si mi cita cambia de hora o se cancela;',
  '- el recordatorio el día de la cita, con enlaces para confirmar, reprogramar o cancelar.',
  '',
  'Los mensajes solo dirán el nombre de la barbería, el servicio, el barbero, la fecha y la hora. No recibiré publicidad por este medio.',
  '',
  'Puedo retirar este permiso cuando quiera desde mi cuenta. Desde ese momento, los avisos me llegarán por correo.',
  '',
  'Si un mensaje por WhatsApp no se puede enviar, el mismo aviso me llegará por correo.',
].join('\n');

/** El texto vigente con el nombre de la barbería; `{número}` queda para la interfaz. */
export function textoParaLaBarberia(nombreBarberia: string): string {
  return TEXTO_CONSENTIMIENTO_WHATSAPP.replace('{nombre de la barbería}', nombreBarberia);
}
