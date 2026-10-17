// Fixture de PR14: un repositorio de citas usa el pool de la vía pública fuera de su carpeta (lectura-publica-confinada).
import { LecturaPublica } from '../../../../shared/lectura-publica';

export class RepositorioCitasMalHecho {
  constructor(readonly lectura: LecturaPublica) {}
}
