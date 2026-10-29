/**
 * T100 (003, contracts/pasarela-simulada.md §3) · Cambia el comportamiento del simulador de la pasarela:
 * `npm run simulador:modo -- <modo> [parámetro]`.
 *
 * - `normal`, `firma_invalida`, `sin_firma`, `fuera_de_orden`, `importe_distinto`, `rechazar`, `colgado`.
 * - `lento <ms>`: demora de cada respuesta y notificación.
 * - `aprobar_despues <ms>`: la sesión se aprueba sola pasado ese tiempo (p. ej. 900000, quickstart §3 paso 8).
 * - `duplicar <veces>`: la misma notificación (mismo evento_id) se envía esas veces.
 * - `caido [ms]`: el puerto se cierra; con ms, se vuelve a abrir solo pasado ese tiempo.
 * - `reiniciar`: vuelve a `normal` y olvida las sesiones.
 *
 * Necesita `SIMULADOR_TOKEN_CONTROL` (el mismo del servicio `pasarela-simulada`); `SIMULADOR_URL` es
 * http://localhost:3100 por defecto. El token no se imprime.
 */
import { MODOS, type Modo } from '../simulador-pagos/modos';

const PARAMETRO: Partial<Record<Modo['modo'], 'retardoMs' | 'veces' | 'duracionMs'>> = {
  lento: 'retardoMs',
  aprobar_despues: 'retardoMs',
  duplicar: 'veces',
  caido: 'duracionMs',
};

async function main(): Promise<void> {
  const [modo, valor] = process.argv.slice(2);
  const token = process.env.SIMULADOR_TOKEN_CONTROL;
  if (!token) throw new Error('Falta SIMULADOR_TOKEN_CONTROL');
  const base = process.env.SIMULADOR_URL ?? 'http://localhost:3100';

  let ruta = '/control/modo';
  let cuerpo: Record<string, unknown> | undefined;
  if (modo === 'reiniciar') {
    ruta = '/control/reiniciar';
  } else {
    if (!modo || !(MODOS as readonly string[]).includes(modo)) {
      throw new Error(`Uso: npm run simulador:modo -- <${[...MODOS, 'reiniciar'].join('|')}> [parámetro]`);
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
  console.log(`Simulador: ${texto || 'reiniciado'}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Error desconocido');
  process.exitCode = 1;
});
