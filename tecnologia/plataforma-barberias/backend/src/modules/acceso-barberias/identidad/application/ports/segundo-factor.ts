/** Códigos de recuperación recién generados: el texto se muestra una sola vez y solo se guarda el hash. */
export interface CodigosRecuperacion {
  codigos: string[];
  hashes: string[];
}

/**
 * Segundo factor del administrador de la plataforma (R07, ADR-031): TOTP del RFC 6238 (HMAC-SHA1, 6 dígitos,
 * paso de 30 s), secreto cifrado en reposo con AES-256-GCM y 10 códigos de recuperación con hash Argon2id.
 *
 * El secreto en claro, la URI `otpauth://` y los códigos solo existen en memoria: nunca se registran, ni se
 * devuelven en una respuesta, ni se guardan sin cifrar o sin hash (SC-010).
 */
export abstract class SegundoFactor {
  /** Secreto TOTP nuevo de 20 bytes (160 bits, el largo del RFC 4226 para HMAC-SHA1). */
  abstract generarSecreto(): Buffer;

  /** Cifra el secreto ligado al administrador (sin ese id no se descifra: no se pueden intercambiar filas). */
  abstract cifrar(secreto: Buffer, adminId: string): Buffer;

  /** Descifra y verifica la integridad. Lanza si el dato o el id no corresponden, o la llave es otra. */
  abstract descifrar(cifrado: Buffer, adminId: string): Buffer;

  /** URI `otpauth://totp/…` para la aplicación de autenticación. Se imprime una sola vez, al crear la cuenta. */
  abstract uri(secreto: Buffer, correo: string): string;

  /**
   * Paso aceptado para el código, con tolerancia de ±1 paso, o null si no corresponde. Un paso que no es
   * mayor que `ultimoPaso` (el último con el que entró el administrador) se rechaza: un código no se reusa.
   */
  abstract verificarCodigo(
    secreto: Buffer,
    codigo: string,
    ahora: Date,
    ultimoPaso: number | null,
  ): number | null;

  abstract generarCodigosRecuperacion(): Promise<CodigosRecuperacion>;

  /** Índice (0 a 9) del código de recuperación, o null si no corresponde o ya se usó. */
  abstract verificarCodigoRecuperacion(
    codigo: string,
    hashes: readonly string[],
    usados: ReadonlySet<number>,
  ): Promise<number | null>;
}
