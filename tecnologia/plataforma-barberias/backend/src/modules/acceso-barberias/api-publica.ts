import type { TenantId } from '../../shared';

// T021 · Interfaces públicas de M01 para M02 (ADR-020, research R05 de 002). Cada clase abstracta es
// también el token de inyección. M02 las importa solo desde acceso-barberias/index.ts; M01 no llama a M02.
//
// 004 (T068; revisión de ADR-013, research R12): M05 las usa AL ENVIAR un aviso, en una transacción con el tenant
// del aviso, para leer el correo del destinatario. Los avisos no guardan datos de contacto.

/** Usuarios del personal de la barbería del contexto (para vincular un barbero del catálogo). */
export abstract class PersonalApi {
  /** Verdadero si el usuario tiene membresía PROPIETARIO o BARBERO ACTIVA en la barbería del contexto. */
  abstract esPersonalActivo(usuarioId: string): Promise<boolean>;
  /**
   * 004: correo del usuario si tiene membresía PROPIETARIO o BARBERO ACTIVA en la barbería del contexto, o null
   * (un usuario de otra barbería, desactivado o que ya no existe no recibe avisos).
   */
  abstract correoDe(usuarioId: string): Promise<string | null>;
}

/**
 * 004 (RF33): cómo avisar a un cliente, leído AL ENVIAR (research R12): el correo, el canal elegido, el número de
 * WhatsApp y si hay un consentimiento vigente PARA ESE número en la barbería del contexto (FR-019).
 */
export interface ContactoParaAvisos {
  /** Null si el cliente (presencial) no dio un correo. */
  correo: string | null;
  canal: 'CORREO' | 'WHATSAPP';
  numeroWhatsapp: string | null;
  consentimientoVigente: boolean;
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
  /** 004 (M05): contacto para avisar al cliente de la barbería del contexto, o null si no existe en ella. */
  abstract contactoParaAvisos(clienteId: string): Promise<ContactoParaAvisos | null>;
}

export interface ConfiguracionAgenda {
  /** Nombre comercial: lo muestran la confirmación de la cita y la agenda. */
  nombre: string;
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
  /**
   * Tenant y datos públicos de la barbería activa con ese enlace, leídos juntos en una sola transacción
   * (006 R07): la vía pública los pide en cada solicitud, nunca de la caché. Mismos errores que
   * `resolverSlugPublico`.
   */
  abstract barberiaPublicaPorEnlace(
    slug: string,
  ): Promise<{ tenantId: TenantId; barberia: DatosPublicosBarberia }>;
  /** 004 (M05): nombre comercial de la barbería del contexto (lo lleva cada aviso). */
  abstract nombre(): Promise<string>;
  /** 004 (M05): correo del propietario ACTIVO de la barbería del contexto, o null si no tiene uno. */
  abstract correoDelPropietario(): Promise<string | null>;
}
