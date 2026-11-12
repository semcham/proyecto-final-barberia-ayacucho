import {
  iniciarSimuladorWhatsapp,
  type MensajeSimulado,
  type SimuladorWhatsapp,
} from '../../simulador-whatsapp/servidor';
import type { Modo } from '../../simulador-whatsapp/modos';

// T114 de 004 · El simulador de WhatsApp (backend/simulador-whatsapp/) arrancado DENTRO del proceso de las
// pruebas, en un puerto libre de 127.0.0.1 (research R11, ADR-026). Nada real: sin credenciales ni proveedor.

/** Token de envío de las pruebas (el mismo que entorno.ts fija en WHATSAPP_TOKEN). */
export const TOKEN_WHATSAPP_PRUEBAS = process.env.WHATSAPP_TOKEN ?? 'whatsapp_token_pruebas';
/** Token de las rutas /control/* y de la consulta de mensajes en las pruebas. */
export const TOKEN_CONTROL_WHATSAPP = 'control_whatsapp_pruebas';

export interface SimuladorDePrueba {
  url: string;
  simulador: SimuladorWhatsapp;
  /** POST /control/modo por HTTP, como lo haría `npm run whatsapp:modo`. */
  modo(modo: Modo): Promise<void>;
  /** GET /mensajes?para= por HTTP (con el token de control). */
  mensajesPara(para: string): Promise<MensajeSimulado[]>;
  cerrar(): Promise<void>;
}

export async function iniciarWhatsappDePrueba(): Promise<SimuladorDePrueba> {
  const simulador = await iniciarSimuladorWhatsapp({
    puerto: 0,
    token: TOKEN_WHATSAPP_PRUEBAS,
    tokenControl: TOKEN_CONTROL_WHATSAPP,
  });
  const control = { 'X-Control': TOKEN_CONTROL_WHATSAPP, 'Content-Type': 'application/json' };
  return {
    url: simulador.url,
    simulador,
    async modo(modo) {
      const respuesta = await fetch(`${simulador.url}/control/modo`, {
        method: 'POST',
        headers: control,
        body: JSON.stringify(modo),
      });
      if (!respuesta.ok) throw new Error(`El simulador respondió ${respuesta.status}`);
    },
    async mensajesPara(para) {
      const respuesta = await fetch(`${simulador.url}/mensajes?${new URLSearchParams({ para })}`, {
        headers: control,
      });
      if (!respuesta.ok) throw new Error(`El simulador respondió ${respuesta.status}`);
      return ((await respuesta.json()) as { mensajes: MensajeSimulado[] }).mensajes;
    },
    cerrar: () => simulador.cerrar(),
  };
}
