import type { Clock, Configuracion } from '../../../shared';
import type { NotificationChannel } from '../application/ports/notification-channel';
import { CanalCorreoSmtp } from './canal-correo-smtp';

/**
 * T033 de 004 · Adaptadores de NotificationChannel elegidos por configuración, como la pasarela en 003
 * (ADR-026). En la fase 1 solo el correo; el WhatsApp simulado se agrega en la fase 5 (WHATSAPP_PROVEEDOR).
 * Es el único lugar fuera de los propios adaptadores que los construye (regla canal-solo-por-puerto).
 */
export function crearCanalDeCorreo(configuracion: Configuracion, reloj: Clock): NotificationChannel {
  const { smtp, remitente, tiempoLimiteMs } = configuracion.correo;
  return new CanalCorreoSmtp({ ...smtp, remitente, tiempoLimiteMs }, reloj);
}
