import { createHash, randomBytes } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { poolDe } from './test-db';

// 010 (T072; research R07; SC-005) · Ayudantes de las pruebas de respuestas neutras (la funcional y la medición).

/** Un enlace de verificación YA USADO de la cuenta, con un token conocido (pertenece a una cuenta: RECHAZADO). */
export async function enlaceUsado(tenantId: string, usuarioId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await poolDe('seed').query(
    `INSERT INTO account_link (id, tenant_id, user_id, purpose, token_hash, requested_at, expires_at, used_at)
     VALUES ($1, $2, $3, 'VERIFICAR_CORREO', $4, now() - interval '1 hour', now() + interval '23 hours', now())`,
    [uuidv7(), tenantId, usuarioId, createHash('sha256').update(token).digest('hex')],
  );
  return token;
}

/** Mediana y percentil (por rango más cercano) de una serie de milisegundos. */
export function percentil(serie: readonly number[], p: number): number {
  const ordenada = [...serie].sort((x, y) => x - y);
  const indice = Math.min(ordenada.length - 1, Math.max(0, Math.ceil((p / 100) * ordenada.length) - 1));
  return ordenada[indice];
}
