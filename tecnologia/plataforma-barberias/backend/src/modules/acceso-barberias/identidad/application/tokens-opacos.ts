import { createHash, randomBytes } from 'node:crypto';

/** Token opaco de 256 bits (renovación de sesión, activación de cuenta). Solo se entrega al cliente. */
export function generarTokenOpaco(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 en hexadecimal: es lo único que se guarda del token opaco. */
export function hashDeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
