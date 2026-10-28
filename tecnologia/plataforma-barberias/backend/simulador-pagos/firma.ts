import { createHmac } from 'node:crypto';

// Firma de las notificaciones del simulador (contracts/pasarela-simulada.md §4):
//   X-Firma: t={segundos unix},v1={HMAC-SHA256 en hexadecimal de "{t}.{cuerpo crudo}"}

export const ENCABEZADO_FIRMA = 'x-firma';

export function firmar(secreto: string, cuerpo: string, t: number): string {
  const v1 = createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex');
  return `t=${t},v1=${v1}`;
}
