import type { Clock, Configuracion } from '../../../shared';
import type { CanalesDeAviso, NotificationChannel } from '../application/ports/notification-channel';
import { CanalCorreoSmtp } from './canal-correo-smtp';
import { CanalWhatsappNoDisponible, CanalWhatsappSimulado } from './canal-whatsapp-simulado';

/**
 * T033/T114 de 004 · Adaptadores de NotificationChannel elegidos por configuración, como la pasarela en 003
 * (ADR-026): el correo por SMTP y, desde la fase 5, WhatsApp según WHATSAPP_PROVEEDOR (`simulado` o `ninguno`). Es
 * el único lugar fuera de los propios adaptadores que los construye (regla canal-solo-por-puerto).
 */
export function crearCanalDeCorreo(configuracion: Configuracion, reloj: Clock): NotificationChannel {
  const { smtp, remitente, tiempoLimiteMs } = configuracion.correo;
  return new CanalCorreoSmtp({ ...smtp, remitente, tiempoLimiteMs }, reloj);
}

export function crearCanalDeWhatsapp(configuracion: Configuracion, reloj: Clock): NotificationChannel {
  const whatsapp = configuracion.whatsapp;
  if (whatsapp.proveedor === 'ninguno') return new CanalWhatsappNoDisponible();
  return new CanalWhatsappSimulado(
    { urlBase: whatsapp.urlBase, token: whatsapp.token, tiempoLimiteMs: whatsapp.tiempoLimiteMs },
    reloj,
  );
}

/** Los dos canales de la tarea de envío, cada uno con su propio interruptor. */
export function crearCanalesDeAviso(configuracion: Configuracion, reloj: Clock): CanalesDeAviso {
  return {
    correo: crearCanalDeCorreo(configuracion, reloj),
    whatsapp: crearCanalDeWhatsapp(configuracion, reloj),
  };
}
