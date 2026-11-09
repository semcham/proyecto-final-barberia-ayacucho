import { v7 as uuidv7 } from 'uuid';
import { CanalCorreoSmtp } from '../../src/modules/notificaciones/infrastructure/canal-correo-smtp';
import { RelojDelSistema } from '../../src/shared';
import {
  iniciarMailpit,
  iniciarSmtpFalso,
  type Mailpit,
  type ModoSmtpFalso,
  type SmtpFalso,
} from '../helpers/mailpit';
import { type CanalEnPrueba, probarContratoDeCanal, type Situacion } from './notification-channel.contract';

// T018 de 004 · La suite de contrato de NotificationChannel contra el adaptador de correo por SMTP (ADR-026),
// con Mailpit en Testcontainers para los envíos reales y un servidor SMTP falso del proceso para el canal
// colgado, caído y los rechazos (550 permanente; 451 temporal).

// El de producción por defecto (CORREO_TIEMPO_LIMITE_MS). Con 800 ms, Mailpit en un equipo cargado llegó a
// tardar más en su primer envío y la prueba fallaba por un límite de la prueba, no del adaptador.
const TIEMPO_LIMITE_MS = 5000;
const REMITENTE = 'no-responder@barberias.local';

probarContratoDeCanal('correo por SMTP (Mailpit)', async () => {
  const mailpit: Mailpit = await iniciarMailpit();
  const falsos: SmtpFalso[] = [];
  const reloj = new RelojDelSistema();
  const canal = (host: string, puerto: number) =>
    new CanalCorreoSmtp(
      { host, puerto, tls: 'no', remitente: REMITENTE, tiempoLimiteMs: TIEMPO_LIMITE_MS },
      reloj,
    );
  const modoFalso: Record<Exclude<Situacion, 'normal'>, ModoSmtpFalso> = {
    colgado: 'colgado',
    caido: 'cierra',
    'rechaza-destinatario': 'rechaza-destinatario',
    limite: 'limite',
  };

  return {
    tiempoLimiteMs: TIEMPO_LIMITE_MS,
    destino: `cliente-${uuidv7()}@prueba.pe`,
    idempotenciaDescarta: false,
    async canalEn(situacion): Promise<CanalEnPrueba> {
      if (situacion === 'normal')
        return { canal: canal(mailpit.host, mailpit.puertoSmtp), llamadas: () => 0 };
      const falso = await iniciarSmtpFalso(modoFalso[situacion]);
      falsos.push(falso);
      return { canal: canal('127.0.0.1', falso.puerto), llamadas: () => falso.conexiones() };
    },
    async recibidos(destino) {
      return (await mailpit.mensajesPara(destino)).map((m) => ({
        texto: m.texto,
        claveIdempotencia: m.messageId.replace(/^<|>$/g, '').split('@')[0],
        charsetUtf8: /charset="?utf-8"?/i.test(m.contentType),
      }));
    },
    async cerrar() {
      await Promise.all(falsos.map((f) => f.cerrar()));
      await mailpit.detener();
    },
  };
});
