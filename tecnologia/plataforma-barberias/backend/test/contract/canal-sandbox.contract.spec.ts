import { CanalCorreoSmtp } from '../../src/modules/notificaciones/infrastructure/canal-correo-smtp';
import { RelojDelSistema } from '../../src/shared';
import { iniciarSmtpFalso, type ModoSmtpFalso, type SmtpFalso } from '../helpers/mailpit';
import { probarContratoDeCanal, type Situacion } from './notification-channel.contract';

// T019 de 004 · La suite de contrato de NotificationChannel contra un proveedor de correo real (ADR-026:
// producción por verificar). Solo corre con las variables SMTP_SANDBOX_* definidas (fuera de CI: necesita
// credenciales y red externa); sin ellas se salta con un aviso, como gateway-sandbox.spec.ts en 003.
// El canal colgado, caído y los rechazos se prueban con el servidor SMTP falso (son del adaptador, no del
// proveedor). Leer lo entregado depende del proveedor: cuando se elija, se completa aquí con su herramienta.

const VARIABLES = [
  'SMTP_SANDBOX_HOST',
  'SMTP_SANDBOX_PUERTO',
  'SMTP_SANDBOX_TLS',
  'SMTP_SANDBOX_USUARIO',
  'SMTP_SANDBOX_CLAVE',
  'SMTP_SANDBOX_REMITENTE',
  'SMTP_SANDBOX_DESTINO',
];
const definidas = VARIABLES.every((v) => Boolean(process.env[v]));

if (!definidas) {
  describe.skip(`Contrato de NotificationChannel: proveedor real (sin ${VARIABLES.join(', ')}: se salta)`, () => {
    it('requiere credenciales de un proveedor de correo de pruebas (ADR-026)', () => undefined);
  });
} else {
  probarContratoDeCanal('proveedor de correo real', async () => {
    const reloj = new RelojDelSistema();
    const falsos: SmtpFalso[] = [];
    const tiempoLimiteMs = 5000;
    const remitente = process.env.SMTP_SANDBOX_REMITENTE as string;
    const modoFalso: Record<Exclude<Situacion, 'normal'>, ModoSmtpFalso> = {
      colgado: 'colgado',
      caido: 'cierra',
      'rechaza-destinatario': 'rechaza-destinatario',
      limite: 'limite',
    };
    return {
      tiempoLimiteMs,
      destino: process.env.SMTP_SANDBOX_DESTINO as string,
      idempotenciaDescarta: false,
      async canalEn(situacion) {
        if (situacion === 'normal') {
          return {
            canal: new CanalCorreoSmtp(
              {
                host: process.env.SMTP_SANDBOX_HOST as string,
                puerto: Number(process.env.SMTP_SANDBOX_PUERTO),
                tls: process.env.SMTP_SANDBOX_TLS as 'no' | 'starttls' | 'implicito',
                usuario: process.env.SMTP_SANDBOX_USUARIO,
                clave: process.env.SMTP_SANDBOX_CLAVE,
                remitente,
                tiempoLimiteMs,
              },
              reloj,
            ),
            llamadas: () => 0,
          };
        }
        const falso = await iniciarSmtpFalso(modoFalso[situacion]);
        falsos.push(falso);
        return {
          canal: new CanalCorreoSmtp(
            { host: '127.0.0.1', puerto: falso.puerto, tls: 'no', remitente, tiempoLimiteMs },
            reloj,
          ),
          llamadas: () => falso.conexiones(),
        };
      },
      recibidos: () => Promise.reject(new Error('Falta la herramienta del proveedor para leer lo entregado')),
      cerrar: async () => {
        await Promise.all(falsos.map((f) => f.cerrar()));
      },
    };
  });
}
