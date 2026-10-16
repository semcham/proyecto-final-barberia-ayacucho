/** Hasta dos iniciales de un nombre, para los avatares. */
export function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  const letras = partes.length > 1 ? [partes[0], partes[partes.length - 1]] : partes;
  return letras.map((parte) => parte.charAt(0).toUpperCase()).join('');
}
