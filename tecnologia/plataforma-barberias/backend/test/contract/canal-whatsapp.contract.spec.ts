import { randomInt } from 'node:crypto';
import { CanalWhatsappSimulado } from '../../src/modules/notificaciones/infrastructure/canal-whatsapp-simulado';
import { RelojDelSistema } from '../../src/shared';
import type { Modo } from '../../simulador-whatsapp/modos';
import { iniciarWhatsappDePrueba, type SimuladorDePrueba, TOKEN_WHATSAPP_PRUEBAS } from '../helpers/whatsapp';
import { type CanalEnPrueba, probarContratoDeCanal, type Situacion } from './notification-channel.contract';

// T107 de 004 · La MISMA suite de contrato de NotificationChannel (T018, sin cambiar sus casos) contra el adaptador
// del WhatsApp simulado (ADR-026; principio VII), con el simulador arrancado en el proceso de prueba. Cada situación
// usa su propio simulador en el modo correspondiente, para que un modo no afecte a otro caso.

const TIEMPO_LIMITE_MS = 3000;

const MODO: Record<Situacion, Modo> = {
  normal: { modo: 'normal' },
  colgado: { modo: 'colgado' },
  caido: { modo: 'caido' },
  'rechaza-destinatario': { modo: 'rechazar' },
  limite: { modo: 'limite' },
};

probarContratoDeCanal('WhatsApp simulado', async () => {
  const reloj = new RelojDelSistema();
  const simuladores: SimuladorDePrueba[] = [];
  const normal = await iniciarWhatsappDePrueba();
  simuladores.push(normal);
  const canal = (url: string) =>
    new CanalWhatsappSimulado(
      { urlBase: url, token: TOKEN_WHATSAPP_PRUEBAS, tiempoLimiteMs: TIEMPO_LIMITE_MS },
      reloj,
    );

  return {
    tiempoLimiteMs: TIEMPO_LIMITE_MS,
    // Un número de prueba propio de esta ejecución (no es de nadie: el simulador no envía nada).
    destino: `+51 9${String(randomInt(10_000_000, 99_999_999))}`,
    idempotenciaDescarta: true,
    async canalEn(situacion): Promise<CanalEnPrueba> {
      if (situacion === 'normal') return { canal: canal(normal.url), llamadas: () => 0 };
      const s = await iniciarWhatsappDePrueba();
      simuladores.push(s);
      await s.modo(MODO[situacion]);
      const inicial = s.simulador.conexiones();
      return { canal: canal(s.url), llamadas: () => s.simulador.conexiones() - inicial };
    },
    async recibidos(destino) {
      return (await normal.mensajesPara(destino)).map((m) => ({
        texto: m.texto,
        claveIdempotencia: m.claveIdempotencia,
        charsetUtf8: m.charsetUtf8,
      }));
    },
    async cerrar() {
      await Promise.all(simuladores.map((s) => s.cerrar()));
    },
  };
});
