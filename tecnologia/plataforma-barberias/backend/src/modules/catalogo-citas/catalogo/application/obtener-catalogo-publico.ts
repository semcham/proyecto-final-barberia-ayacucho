import { Injectable } from '@nestjs/common';
import { CacheCompartida, ClavesCache, Configuracion, type TenantId } from '../../../../shared';
import { crearEntradaCatalogo, datosDeEntrada, leerEntradaCatalogo } from './entrada-catalogo';
import { type CatalogoPublicoDatos, CatalogoPublicoQuery } from './ports/catalogo-publico-query';

/**
 * T036 (006) · Catálogo público de una barbería con la caché compartida entre réplicas (R07, R08).
 *
 * Cache-aside con generación: si la entrada falta, se lee la generación ANTES de consultar la base y se
 * guarda solo si sigue igual. Si un cambio se confirma mientras tanto, la generación subió y la entrada vieja
 * no se guarda. Si Redis falla, `CacheCompartida` no lanza: se responde desde PostgreSQL.
 */
@Injectable()
export class ObtenerCatalogoPublico {
  constructor(
    private readonly cache: CacheCompartida,
    private readonly consulta: CatalogoPublicoQuery,
    private readonly configuracion: Configuracion,
  ) {}

  async ejecutar(tenantId: TenantId): Promise<CatalogoPublicoDatos> {
    if (!this.configuracion.cache.catalogoActiva) return this.consulta.catalogo(tenantId);

    const enCache = await this.soloDesdeCache(tenantId);
    if (enCache) return enCache;

    const generacion = ClavesCache.generacionCatalogo(tenantId);
    const vigente = await this.cache.leerGeneracion(generacion);
    const datos = await this.consulta.catalogo(tenantId);
    // Sin generación (Redis no responde) no se intenta guardar.
    if (vigente !== null) {
      await this.cache.guardarSiGeneracion(
        ClavesCache.catalogoPublico(tenantId),
        generacion,
        vigente,
        crearEntradaCatalogo(datos, vigente),
        this.configuracion.cache.ttlCatalogoSegundos,
      );
    }
    return datos;
  }

  /**
   * La entrada en caché sin llenarla (para los horarios, R11), o `null` si la caché está desactivada, la
   * entrada falta o no se puede leer, o Redis no responde.
   */
  async soloDesdeCache(tenantId: TenantId): Promise<CatalogoPublicoDatos | null> {
    if (!this.configuracion.cache.catalogoActiva) return null;
    const entrada = leerEntradaCatalogo(await this.cache.obtener(ClavesCache.catalogoPublico(tenantId)));
    return entrada ? datosDeEntrada(entrada) : null;
  }
}
