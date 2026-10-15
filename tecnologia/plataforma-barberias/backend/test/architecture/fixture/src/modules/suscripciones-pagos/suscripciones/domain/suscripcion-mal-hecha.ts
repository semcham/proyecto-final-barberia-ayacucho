// Fixture de PR14: M03 importa una clase interna de M01 (matriz-m03, modulos-solo-por-index).
import { RepositorioKysely } from '../../../acceso-barberias/identidad/infrastructure/repositorio-kysely';

export class SuscripcionMalHecha {
  constructor(readonly repositorio: RepositorioKysely) {}
}
