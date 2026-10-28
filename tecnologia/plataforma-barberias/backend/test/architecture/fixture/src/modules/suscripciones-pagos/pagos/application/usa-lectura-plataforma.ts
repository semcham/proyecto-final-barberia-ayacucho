// Violación a propósito (T015 de 003): un caso de uso usa el rol de la plataforma fuera de infrastructure/plataforma/.
import { LecturaPlataforma } from '../../../../shared/lectura-plataforma';

export class CasoDeUsoMalHecho {
  constructor(readonly lectura: LecturaPlataforma) {}
}
