/**
 * 011 (T026) · Pegado desde una hoja de cálculo (Excel, Google Sheets): convierte el texto copiado en filas de la tabla
 * de carga en lote (specs/011-carga-masiva-catalogo/contracts/pantallas.md, "Pegado desde una hoja").
 *
 * Solo ORDENA lo pegado (columnas, comillas, encabezado, coma decimal, "S/", "30 min"). No valida: las reglas viven en
 * el servidor y la revisión marca lo que esté mal.
 */

/** Celdas de cada línea: tabulaciones entre columnas; comillas de Excel con tabulaciones o saltos dentro. */
export function celdasDeHoja(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = '';
  let entreComillas = false;
  const normalizado = texto.replace(/\r\n?/g, '\n');

  for (let i = 0; i < normalizado.length; i++) {
    const c = normalizado[i];
    if (entreComillas) {
      if (c === '"' && normalizado[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') {
        entreComillas = false;
      } else {
        celda += c;
      }
    } else if (c === '"' && celda === '') {
      entreComillas = true;
    } else if (c === '\t') {
      fila.push(celda);
      celda = '';
    } else if (c === '\n') {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else {
      celda += c;
    }
  }
  if (celda !== '' || fila.length > 0) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas
    .map((f) => f.map((valor) => valor.replace(/\s+/g, ' ').trim()))
    .filter((f) => f.some((valor) => valor !== ''));
}

/** "S/ 25,50" → "25.50"; lo que no se entiende queda tal cual para que la revisión lo marque. */
export function precioDeCelda(valor: string): string {
  const limpio = valor.replace(/^s\/\.?\s*/i, '').replace(/\s+/g, '');
  return /^\d+,\d{1,2}$/.test(limpio) ? limpio.replace(',', '.') : limpio;
}

/** "30 min" → "30"; un número decimal con coma también se convierte ("7,5" → "7.5"). */
export function duracionDeCelda(valor: string): string {
  const numero = /^(\d+(?:[.,]\d+)?)/.exec(valor.trim());
  return numero ? numero[1].replace(',', '.') : valor.trim();
}

const PALABRAS_DE_ENCABEZADO = /^(nombre|servicio|barbero|nombres?)$/i;

/** Una primera línea como "Nombre | Duración | Precio" se descarta: sus celdas de números no tienen números. */
function esEncabezado(celdas: string[]): boolean {
  if (!PALABRAS_DE_ENCABEZADO.test(celdas[0] ?? '')) return false;
  return celdas.slice(1).every((c) => !/\d/.test(c));
}

export interface FilaPegadaServicio {
  nombre: string;
  duracion: string;
  precio: string;
  descripcion: string;
}

export interface ResultadoPegado<T> {
  filas: T[];
  /** Filas que no entraron por el tope. */
  fuera: number;
}

/** Filas de servicio (nombre, duración, precio, descripción) hasta completar `espacio` filas libres. */
export function serviciosDePegado(texto: string, espacio: number): ResultadoPegado<FilaPegadaServicio> {
  const lineas = celdasDeHoja(texto);
  if (lineas.length > 0 && esEncabezado(lineas[0])) lineas.shift();
  const filas = lineas.map(([nombre = '', duracion = '', precio = '', descripcion = '']) => ({
    nombre,
    duracion: duracionDeCelda(duracion),
    precio: precioDeCelda(precio),
    descripcion,
  }));
  const libres = Math.max(0, espacio);
  return { filas: filas.slice(0, libres), fuera: Math.max(0, filas.length - libres) };
}

/** Nombres de barbero: solo la primera columna. */
export function nombresDePegado(texto: string, espacio: number): ResultadoPegado<string> {
  const lineas = celdasDeHoja(texto);
  if (lineas.length > 0 && esEncabezado(lineas[0])) lineas.shift();
  const nombres = lineas.map(([nombre = '']) => nombre).filter((n) => n !== '');
  const libres = Math.max(0, espacio);
  return { filas: nombres.slice(0, libres), fuera: Math.max(0, nombres.length - libres) };
}
