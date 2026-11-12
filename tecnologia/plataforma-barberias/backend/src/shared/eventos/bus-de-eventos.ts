import type { TenantId } from '../tenant/tenant-id';

// Puerto del bus de eventos de M06 (ADR-025, contracts/eventos.md §1), sin reglas de negocio. Los casos de uso
// publican hechos en su propia transacción; los módulos que los consumen (M05) se suscriben desde la raíz de
// composición (host/eventos.ts). Nadie llama directamente a M05.

/** Un hecho del dominio. El payload lleva solo lo que el mensaje necesita: nunca datos de contacto. */
export interface EventoDeDominio {
  /** Tipo en PascalCase, p. ej. `CitaCreada` (catálogo en contracts/eventos.md §3). */
  tipo: string;
  payload: Record<string, unknown>;
}

/** El evento tal como lo recibe el manejador: con su id y el tenant de la transacción que lo publicó. */
export interface EventoPublicado extends EventoDeDominio {
  id: string;
  tenantId: TenantId;
  creadoEn: Date;
}

/**
 * Manejador de un tipo de evento. Corre en la transacción del despacho, con el tenant del evento: lo que
 * escriba se confirma junto con el estado PROCESADO, o se revierte entero si lanza. Debe ser idempotente.
 */
export type ManejadorDeEvento = (evento: EventoPublicado) => Promise<void>;

export abstract class BusDeEventos {
  /**
   * Inserta el evento en la transacción en curso, con su tenant (falla si no hay transacción o tenant) y pide
   * su despacho tras el COMMIT. Con `disponibleDesde` futuro, lo despacha la tarea cuando llegue el momento.
   * Devuelve el id del evento.
   */
  abstract publicar(evento: EventoDeDominio, opciones?: { disponibleDesde?: Date }): Promise<string>;

  /** Anula el pendiente con esa clave en el tenant y publica el nuevo, en la misma transacción. */
  abstract reemplazar(
    clave: string,
    evento: EventoDeDominio,
    opciones: { disponibleDesde: Date },
  ): Promise<string>;

  /**
   * Publica el evento con una clave que solo puede usarse UNA vez en el tenant (índice único de la migración 0021,
   * hoy `prueba-por-terminar:<id>`). Si ya existe un evento con esa clave, en cualquier estado, no publica nada y
   * devuelve null; nunca aborta la transacción. Dos réplicas a la vez publican uno solo.
   */
  abstract publicarUnaVez(clave: string, evento: EventoDeDominio): Promise<string | null>;

  /** Anula el pendiente con esa clave en el tenant, si existe. Devuelve si había uno. */
  abstract anular(clave: string): Promise<boolean>;

  /** Registra el manejador de un tipo. Solo desde la raíz de composición (host/eventos.ts). */
  abstract suscribir(tipo: string, manejador: ManejadorDeEvento): void;
}
