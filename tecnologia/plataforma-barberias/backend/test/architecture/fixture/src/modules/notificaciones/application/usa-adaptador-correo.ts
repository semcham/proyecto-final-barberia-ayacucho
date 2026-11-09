// Violación a propósito (T020 de 004, canal-solo-por-puerto): el envío se pide por el puerto
// NotificationChannel, nunca al adaptador.
import { CanalCorreoSmtp } from '../infrastructure/canal-correo-smtp';

export const usaAdaptador = CanalCorreoSmtp;
