/**
 * T112 (004, contracts/notification-channel.md §3) · Cambia el comportamiento del WhatsApp simulado:
 * `npm run whatsapp:modo -- <modo> [parámetro]`.
 *
 * - `normal`, `colgado`, `rechazar` (400, número inválido), `limite` (429).
 * - `lento <ms>`: demora de cada respuesta.
 * - `caido [ms]`: corta cada envío; con ms, vuelve solo a normal pasado ese tiempo.
 * - `fallar_n <veces>`: falla los N primeros envíos (503) y después acepta.
 * - `reiniciar`: borra los mensajes y vuelve a normal.
 *
 * Necesita `WHATSAPP_TOKEN_CONTROL` (el mismo del servicio `whatsapp-simulado`); `WHATSAPP_SIMULADO_URL` es
 * http://localhost:3200 por defecto. El token no se imprime.
 */
import { MODOS, type Modo } from '../simulador-whatsapp/modos';

const PARAMETRO: Partial<Record<Modo['modo'], 'retardoMs' | 'duracionMs' | 'veces'>> = {
  lento: 'retardoMs',
  caido: 'duracionMs',
  fallar_n: 'veces',
};

async function main(): Promise<void> {
  const [modo, valor] = process.argv.slice(2);
  const token = process.env.WHATSAPP_TOKEN_CONTROL;
  if (!token) throw new Error('Falta WHATSAPP_TOKEN_CONTROL');
  const base = process.env.WHATSAPP_SIMULADO_URL ?? 'http://localhost:3200';

  let ruta = '/control/modo';
  let cuerpo: Record<string, unknown> | undefined;
  if (modo === 'reiniciar') {
    ruta = '/control/reiniciar';
  } else {
    if (!modo || !(MODOS as readonly string[]).includes(modo)) {
      throw new Error(`Uso: npm run whatsapp:modo -- <${[...MODOS, 'reiniciar'].join('|')}> [parámetro]`);
    }
    cuerpo = { modo };
    const campo = PARAMETRO[modo as Modo['modo']];
    if (valor !== undefined) {
      const numero = Number(valor);
      if (!campo || !Number.isInteger(numero) || numero < 0) {
        throw new Error(`El modo ${modo} ${campo ? 'espera un entero no negativo' : 'no lleva parámetro'}`);
      }
      cuerpo[campo] = numero;
    }
  }

  const respuesta = await fetch(`${base}${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Control': token },
    body: JSON.stringify(cuerpo ?? {}),
  });
  const texto = await respuesta.text();
  if (!respuesta.ok) throw new Error(`El simulador respondió ${respuesta.status}: ${texto}`);
  console.log(`WhatsApp simulado: ${texto || 'reiniciado'}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido');
  process.exitCode = 1;
});
