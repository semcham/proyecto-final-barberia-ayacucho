/**
 * Intentos fallidos de inicio de sesión por par cuenta + IP (tabla técnica global `login_attempt`, R10).
 * La cuenta se identifica por el SHA-256 del correo normalizado; el correo no se guarda.
 */
export abstract class IntentosRepository {
  /** Fallos del par desde `desde` (el historial útil es de 24 h). */
  abstract fallosDesde(hashCorreo: string, ip: string, desde: Date): Promise<Date[]>;
  /** Registra un fallo y, en la misma sentencia, purga los intentos de más de 24 h (purga oportunista). */
  abstract registrarFallo(hashCorreo: string, ip: string, ahora: Date): Promise<void>;
  /** Un acierto borra los fallos del par. */
  abstract borrarFallos(hashCorreo: string, ip: string): Promise<void>;
}
