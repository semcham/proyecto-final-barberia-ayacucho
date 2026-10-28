// Fixture de PR14 (T015 de 003): uso PERMITIDO del rol de la plataforma, que no debe señalarse.
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';

export class PagoPorReferencia {
  constructor(readonly lectura: LecturaPlataforma) {}
}
