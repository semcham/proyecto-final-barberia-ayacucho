import { Injectable } from '@nestjs/common';
import { TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { BarberiasApi, type ConfiguracionAgenda, type DatosPublicosBarberia } from '../../api-publica';
import { BarberiaNoDisponible } from '../domain/errores';
import { TenantRepository } from './ports/tenant-repository';

// Mismo formato que la columna tenant.slug; cualquier otro valor da "barbería no disponible".
const FORMATO_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LARGO_MAXIMO_SLUG = 140;

/** T022 · Implementación de `BarberiasApi` (interfaz pública de M01 para M02). */
@Injectable()
export class BarberiasApiImpl extends BarberiasApi {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tenantContext: TenantContext,
    private readonly tenants: TenantRepository,
  ) {
    super();
  }

  async configuracionAgenda(): Promise<ConfiguracionAgenda> {
    // Se usa dentro del caso de uso de M02, con la transacción del tenant del token ya abierta.
    const configuracion = await this.tenants.configuracionAgenda(this.tenantContext.actual().valor);
    if (!configuracion) throw new Error('La barbería del contexto no existe');
    return configuracion;
  }

  async datosPublicos(tenantId: TenantId): Promise<DatosPublicosBarberia | null> {
    // tenant es una tabla global: su lectura no depende del contexto de tenant (R15 de 002).
    return this.uow.ejecutarSinTenant(() => this.tenants.datosPublicos(tenantId.valor));
  }

  async resolverSlugPublico(slug: string): Promise<TenantId> {
    exigirFormato(slug);
    const id = await this.uow.ejecutarSinTenant(() => this.tenants.idActivaPorSlug(slug));
    if (!id) throw new BarberiaNoDisponible();
    return TenantId.de(id);
  }

  async barberiaPublicaPorEnlace(
    slug: string,
  ): Promise<{ tenantId: TenantId; barberia: DatosPublicosBarberia }> {
    exigirFormato(slug);
    const fila = await this.uow.ejecutarSinTenant(() => this.tenants.datosPublicosPorSlug(slug));
    if (!fila) throw new BarberiaNoDisponible();
    return { tenantId: TenantId.de(fila.id), barberia: fila.barberia };
  }
}

function exigirFormato(slug: string): void {
  if (typeof slug !== 'string' || slug.length > LARGO_MAXIMO_SLUG || !FORMATO_SLUG.test(slug)) {
    throw new BarberiaNoDisponible();
  }
}
