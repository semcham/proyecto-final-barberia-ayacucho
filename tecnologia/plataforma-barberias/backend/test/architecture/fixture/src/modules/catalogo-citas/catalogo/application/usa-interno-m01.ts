// Fixture de PR14: M02 importa una clase interna de M01 en lugar de su index (matriz-m02, modulos-solo-por-index).
import { RepositorioKysely } from '../../../acceso-barberias/identidad/infrastructure/repositorio-kysely';

export class UsaInternoDeM01 {
  constructor(readonly repositorio: RepositorioKysely) {}
}
