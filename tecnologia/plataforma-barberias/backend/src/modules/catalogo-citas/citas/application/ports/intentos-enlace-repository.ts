/**
 * T092 de 004 · Rechazos de los enlaces de acción por origen (tabla técnica `action_link_attempt`, sin barbería
 * ni RLS: constitución 1.4.1, principio III, tablas técnicas de intentos; data-model §5). El adaptador guarda solo
 * SHA-256(ENLACES_SAL_IP ‖ IP), nunca la IP en claro. Se usa FUERA de cualquier transacción con barbería: un
 * enlace rechazado no trae una barbería confiable.
 */
export abstract class IntentosEnlaceRepository {
  /** Instantes de los rechazos de esa IP desde `desde`. */
  abstract fallosDesde(ip: string, desde: Date): Promise<Date[]>;
  /** Anota un rechazo de esa IP. */
  abstract registrar(ip: string, en: Date): Promise<void>;
  /** Purga (tarea purgar-intentos-enlaces): borra hasta `lote` filas anteriores a `limite`; devuelve cuántas. */
  abstract purgarAnterioresA(limite: Date, lote: number): Promise<number>;
}
