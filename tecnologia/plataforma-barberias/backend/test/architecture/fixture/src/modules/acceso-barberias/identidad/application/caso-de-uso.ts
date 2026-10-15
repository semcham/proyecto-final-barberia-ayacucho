// Fixture de PR14.
import { RepositorioKysely } from '../infrastructure/repositorio-kysely'; // aplicacion-sin-infraestructura

export class CasoDeUso {
  constructor(readonly repositorio: RepositorioKysely) {}
}
