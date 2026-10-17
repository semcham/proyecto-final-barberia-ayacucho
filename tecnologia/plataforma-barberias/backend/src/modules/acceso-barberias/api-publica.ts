import type { TenantId } from '../../shared';

// T021 · Interfaces públicas de M01 para M02 (ADR-020, research R05 de 002). Cada clase abstracta es
// también el token de inyección. M02 las importa solo desde acceso-barberias/index.ts; M01 no llama a M02.

/** Usuarios del personal de la barbería del contexto (para vincular un barbero del catálogo). */
export abstract class PersonalApi {
  /** Verdadero si el usuario tiene membresía PROPIETARIO o BARBERO ACTIVA en la barbería del contexto. */
  abstract esPersonalActivo(usuarioId: string): Promise<boolean>;
}

export interface PerfilClienteResumen {
  clienteId: string;
  nombre: string;
  telefono: string;
}

/** Clientes de la barbería del contexto (perfil por barbería). */
export abstract class ClientesApi {
  /** Perfil del cliente con cuenta `usuarioId` en la barbería del contexto, o null. */
  abstract perfilDeSesion(usuarioId: string): Promise<PerfilClienteResumen | null>;
  /** Nombre y teléfono de varios clientes de la barbería del contexto, en una sola consulta. */
  abstract datosDeContacto(clienteIds: readonly string[]): Promise<PerfilClienteResumen[]>;
  /** Perfil de un cliente (con cuenta o presencial) de la barbería del contexto, o null. */
  abstract perfilDeBarberia(clienteId: string): Promise<PerfilClienteResumen | null>;
}

export interface ConfiguracionAgenda {
  zonaHoraria: string;
  antelacionCancelacionMinutos: number;
}

/** Datos que la barbería publica en su catálogo (FR-018). Sin estado ni datos de cuentas. */
export interface DatosPublicosBarberia {
  nombre: string;
  slug: string;
  direccion: string | null;
  telefono: string | null;
  descripcion: string | null;
  zonaHoraria: string;
}

/** Datos de la barbería que necesitan el catálogo y las citas. */
export abstract class BarberiasApi {
  /** Zona horaria y antelación mínima de cancelación de la barbería del contexto (transacción en curso). */
  abstract configuracionAgenda(): Promise<ConfiguracionAgenda>;
  /** Datos públicos de una barbería activa, o null si no existe o está suspendida. */
  abstract datosPublicos(tenantId: TenantId): Promise<DatosPublicosBarberia | null>;
  /**
   * Tenant de la barbería activa con ese enlace público (ADR-021, decisión 3). Lanza
   * `BarberiaNoDisponible` si el enlace no existe, cambió o la barbería está suspendida: misma respuesta
   * en todos los casos (FR-022).
   */
  abstract resolverSlugPublico(slug: string): Promise<TenantId>;
}
