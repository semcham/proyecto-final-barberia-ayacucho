import { iniciarSimulador, type OpcionesSimulador, type Simulador } from '../../simulador-pagos/servidor';

/** Token de las rutas /control/* del simulador en las pruebas. */
export const TOKEN_CONTROL_PRUEBAS = 'control_pruebas_integracion';

/**
 * Inicia el simulador de la pasarela dentro del proceso de Jest, en un puerto libre, con los secretos del
 * entorno de pruebas (helpers/entorno.ts), y fija PAGOS_URL_BASE para que la aplicación que se cree después
 * (crearApp) hable con él. `urlNotificaciones`: adónde notifica (p. ej. `${app.url}/api/v1/pagos/notificaciones`);
 * se puede cambiar luego con `simulador.cambiarDestino`.
 */
export async function iniciarSimuladorDePrueba(
  opciones: Partial<
    Omit<OpcionesSimulador, 'puerto' | 'secretoFirma' | 'llaveSecreta' | 'tokenControl'>
  > = {},
): Promise<Simulador> {
  const simulador = await iniciarSimulador({
    puerto: 0,
    secretoFirma: process.env.PAGOS_SECRETO_FIRMA as string,
    llaveSecreta: process.env.PAGOS_LLAVE_SECRETA as string,
    tokenControl: TOKEN_CONTROL_PRUEBAS,
    urlNotificaciones: opciones.urlNotificaciones ?? 'http://127.0.0.1:9/sin-destino',
    esperaReintentoMs: opciones.esperaReintentoMs ?? 50,
    ...opciones,
  });
  process.env.PAGOS_URL_BASE = simulador.url;
  return simulador;
}

/** Decide una sesión del simulador sin navegador (pruebas y demos). */
export async function decidirEnSimulador(
  simulador: Simulador,
  referencia: string,
  accion: 'aprobar' | 'rechazar' | 'devolver',
  opciones: { notificar?: boolean } = {},
): Promise<void> {
  const respuesta = await fetch(`${simulador.url}/control/sesiones/${referencia}/${accion}`, {
    method: 'POST',
    headers: { 'X-Control': TOKEN_CONTROL_PRUEBAS, 'Content-Type': 'application/json' },
    body: JSON.stringify(opciones),
  });
  if (!respuesta.ok) throw new Error(`El simulador no pudo ${accion} la sesión: ${respuesta.status}`);
}
