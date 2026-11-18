// Violación a propósito (T046 de 007): el catálogo de M02 usa el rol de la plataforma. Solo las citas
// (catalogo-citas/citas/infrastructure/plataforma/) pueden, para las vistas de conteo; lo prohíbe
// lectura-plataforma-confinada.
import { LecturaPlataforma } from '../../../../shared/lectura-plataforma';

export class CatalogoConPlataforma {
  constructor(readonly lectura: LecturaPlataforma) {}
}
