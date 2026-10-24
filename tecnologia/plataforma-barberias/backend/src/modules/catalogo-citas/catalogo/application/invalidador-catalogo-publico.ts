import { Injectable } from '@nestjs/common';
import { CacheCompartida, ClavesCache, type TenantId, UnitOfWork } from '../../../../shared';

/**
 * T037 (006) · Invalida el catálogo público de una barbería después de confirmar un cambio de la matriz de
 * invalidación (contracts/cache-claves.md §3). Se llama dentro de la transacción del caso de uso: con
 * ROLLBACK no invalida nada, y con COMMIT sube la generación y borra la entrada (R08).
 */
@Injectable()
export class InvalidadorCatalogoPublico {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly cache: CacheCompartida,
  ) {}

  catalogoCambio(tenantId: TenantId): void {
    this.uow.alConfirmar(() =>
      this.cache.invalidar(ClavesCache.catalogoPublico(tenantId), ClavesCache.generacionCatalogo(tenantId)),
    );
  }
}
