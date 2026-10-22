import { TenantId } from '../tenant/tenant-id';

/**
 * Claves de la caché compartida (ADR-029, specs/006-escalado-cache-balanceo/contracts/cache-claves.md).
 *
 * - Solo `ClavesCache` crea claves de datos de una barbería, y todas exigen un `TenantId` (FR-014,
 *   principio III): no hay forma de construir una sin él, ni claves derivadas del `slug` o de texto libre.
 * - Prefijo versionado `bp:v1:` (datos) y `rl:v1:` (contadores): cambiar el formato obliga a subir la
 *   versión, y lo viejo queda inalcanzable (FR-015).
 */

const SELLO = Symbol('ClavesCache');
const PREFIJO_DATOS = 'bp:v1:';
const PREFIJO_CONTADOR = 'rl:v1:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const CLAVE_LIMITE = /^[\w:.-]{1,200}$/;

function sellada(sello: symbol, tipo: string): void {
  if (sello !== SELLO) throw new Error(`Una ${tipo} solo se crea con ClavesCache`);
}

/** Clave de un valor guardado (por ejemplo, el catálogo público de una barbería). */
export class ClaveCache {
  constructor(
    sello: symbol,
    readonly valor: string,
  ) {
    sellada(sello, 'ClaveCache');
  }
}

/** Clave del contador de generación que invalida los valores de una barbería (R08). */
export class ClaveGeneracion {
  constructor(
    sello: symbol,
    readonly valor: string,
  ) {
    sellada(sello, 'ClaveGeneracion');
  }
}

/**
 * Clave de un contador del límite general de solicitudes (principio VIII): por IP, sin tenant. Solo la
 * construye el almacenamiento de límites a partir de la clave que calcula `@nestjs/throttler`.
 */
export class ClaveContador {
  constructor(
    sello: symbol,
    readonly valor: string,
  ) {
    if (sello !== SELLO) throw new Error('Un ClaveContador solo se crea con ClaveContador.desde');
  }

  static desde(claveDelLimite: string): ClaveContador {
    if (typeof claveDelLimite !== 'string' || !CLAVE_LIMITE.test(claveDelLimite)) {
      throw new Error('La clave del límite no tiene un formato válido');
    }
    return new ClaveContador(SELLO, `${PREFIJO_CONTADOR}${claveDelLimite}`);
  }
}

function deBarberia(tenantId: TenantId): string {
  if (!(tenantId instanceof TenantId)) {
    throw new Error('Las claves de caché de una barbería exigen un TenantId');
  }
  return `${PREFIJO_DATOS}t:${tenantId.valor}:`;
}

function uuid(valor: string, campo: string): string {
  if (typeof valor !== 'string' || !UUID.test(valor)) {
    throw new Error(`${campo} debe ser un UUID en minúsculas`);
  }
  return valor;
}

/** Fábrica única de claves de datos de una barbería. */
export const ClavesCache = {
  /** Catálogo público: horario de atención, servicios y barberos activos (R07). */
  catalogoPublico(tenantId: TenantId): ClaveCache {
    return new ClaveCache(SELLO, `${deBarberia(tenantId)}catalogo-publico`);
  },

  generacionCatalogo(tenantId: TenantId): ClaveGeneracion {
    return new ClaveGeneracion(SELLO, `${deBarberia(tenantId)}catalogo-publico:gen`);
  },

  /** Horarios calculados (FR-013b, R10): la generación forma parte de la clave. */
  horarios(
    tenantId: TenantId,
    generacion: number,
    servicioId: string,
    fecha: string,
    barberoId: string | null,
  ): ClaveCache {
    const prefijo = deBarberia(tenantId);
    if (!Number.isInteger(generacion) || generacion < 0) {
      throw new Error('La generación debe ser un entero mayor o igual a 0');
    }
    if (typeof fecha !== 'string' || !FECHA.test(fecha)) {
      throw new Error('La fecha debe tener el formato AAAA-MM-DD');
    }
    const barbero = barberoId === null ? 'todos' : uuid(barberoId, 'barberoId');
    return new ClaveCache(
      SELLO,
      `${prefijo}horarios:g${generacion}:${uuid(servicioId, 'servicioId')}:${fecha}:${barbero}`,
    );
  },

  generacionHorarios(tenantId: TenantId): ClaveGeneracion {
    return new ClaveGeneracion(SELLO, `${deBarberia(tenantId)}horarios:gen`);
  },
};
