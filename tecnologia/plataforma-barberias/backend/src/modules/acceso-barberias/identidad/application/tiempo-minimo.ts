/**
 * 010 (research R07) · Ejecuta `fn` y no responde antes de `minimoMs`, termine bien o con error: así la escritura extra
 * cuando la cuenta existe (o el enlace pertenece a una cuenta) no se nota en el tiempo de respuesta. Usa el reloj real a
 * propósito: el piso protege tiempos de red, no fechas de negocio.
 */
export async function conTiempoMinimo<T>(minimoMs: number, fn: () => Promise<T>): Promise<T> {
  const inicio = performance.now();
  try {
    return await fn();
  } finally {
    const resta = minimoMs - (performance.now() - inicio);
    if (resta > 0) await new Promise((resolver) => setTimeout(resolver, Math.ceil(resta)));
  }
}
