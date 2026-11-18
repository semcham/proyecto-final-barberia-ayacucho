// Uso permitido (T046 de 007): la carpeta infrastructure/plataforma/ de las citas de M02 lee la vista de conteo con el
// rol de la plataforma (enmienda 1.7.0, revisión de ADR-031). lectura-plataforma-confinada no lo señala.
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';

export class ConteosPermitidos {
  constructor(readonly lectura: LecturaPlataforma) {}
}
