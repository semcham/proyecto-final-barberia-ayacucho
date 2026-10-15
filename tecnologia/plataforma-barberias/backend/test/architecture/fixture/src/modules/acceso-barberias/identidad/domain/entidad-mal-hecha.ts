// Fixture de PR14 con violaciones a propósito. No es código de la aplicación.
import { Injectable } from '@nestjs/common'; // dominio-sin-frameworks
import { KyselyUnitOfWork } from '../../../../shared/persistence/kysely-unit-of-work'; // dominio-solo-nucleo-puro, m06-solo-por-interfaz-publica
import { CasoDeUso } from '../application/caso-de-uso'; // dominio-solo-dominio

@Injectable()
export class EntidadMalHecha {
  constructor(
    readonly uow: KyselyUnitOfWork,
    readonly casoDeUso: CasoDeUso,
  ) {}
}
