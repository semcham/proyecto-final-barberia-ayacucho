// Forma de un texto legal publicado (010, US3; research R10). Cada texto es un archivo versionado de esta carpeta. El
// texto admite dos marcas mínimas, que DocumentoLegal convierte en elementos: `código` y [texto del enlace](/ruta).

export type Bloque = { tipo: 'parrafo'; texto: string } | { tipo: 'lista'; items: string[] };

export interface Seccion {
  /** Ancla de la sección (minúsculas y guiones). */
  id: string;
  titulo: string;
  bloques: Bloque[];
}

export interface DocumentoLegal {
  titulo: string;
  /** La que se acepta en los formularios y se guarda con el consentimiento (TERMS_VERSION / PRIVACY_POLICY_VERSION). */
  version: string;
  /** Fecha ISO (AAAA-MM-DD) desde la que rige esta versión. */
  vigenteDesde: string;
  /** Mientras el responsable humano no lo revise, la página lo dice (FR-027). */
  borrador: boolean;
  resumen: string;
  secciones: Seccion[];
}

export const parrafo = (texto: string): Bloque => ({ tipo: 'parrafo', texto });
export const lista = (...items: string[]): Bloque => ({ tipo: 'lista', items });
