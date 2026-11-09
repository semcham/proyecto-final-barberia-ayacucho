// Fixture de PR14 (T029 de 004): uso PERMITIDO del rol de la plataforma desde M05 (listar avisos pendientes
// por sus columnas técnicas), que no debe señalarse.
import { LecturaPlataforma } from '../../../../shared/lectura-plataforma';

export class AvisosPendientes {
  constructor(readonly lectura: LecturaPlataforma) {}
}
