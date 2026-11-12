// T008 de 008 · Código de la reserva que el cliente escribe en el mensaje del pago (research R07). Seis caracteres
// de un alfabeto sin ambigüedades: sin 0/O ni 1/I/L. Único dentro de la barbería (UNIQUE (tenant_id, code)); si el
// alta choca, la infraestructura prueba otro código.

export const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const LONGITUD = 6;
/** Mayor múltiplo de la longitud del alfabeto que cabe en un byte: los bytes desde aquí sesgarían el reparto. */
const TOPE = Math.floor(256 / ALFABETO_CODIGO.length) * ALFABETO_CODIGO.length;
const FORMATO = new RegExp(`^[${ALFABETO_CODIGO}]{${LONGITUD}}$`);

/**
 * Un código nuevo. `aleatorio(n)` entrega n bytes aleatorios (en infraestructura, randomBytes de node:crypto): el
 * dominio no elige la fuente. Se descartan los bytes que sesgarían el reparto (rechazo, no módulo).
 */
export function generarCodigoDeReserva(aleatorio: (n: number) => Uint8Array): string {
  let codigo = '';
  while (codigo.length < LONGITUD) {
    const bytes = aleatorio(LONGITUD - codigo.length);
    if (bytes.length === 0) throw new Error('La fuente aleatoria no entregó bytes');
    for (const byte of bytes) {
      if (byte < TOPE && codigo.length < LONGITUD) codigo += ALFABETO_CODIGO[byte % ALFABETO_CODIGO.length];
    }
  }
  return codigo;
}

export function esCodigoDeReserva(texto: string): boolean {
  return FORMATO.test(texto);
}
