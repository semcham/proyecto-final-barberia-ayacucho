import type { CanalDeAviso } from './notification-channel';
import type { CodigoErrorAviso, Destinatario, TipoAviso } from '../../domain/aviso';

// T070 de 004 · Puertos de los avisos de M05 (data-model.md §4; FR-012; research R08, R13).

export interface NuevoAviso {
  id: string;
  eventoId: string;
  tipo: TipoAviso;
  destinatario: Destinatario;
  citaId: string | null;
  canalPrevisto: CanalDeAviso;
  descartarDespues: Date;
}

/** Un aviso reclamado para enviarlo, con el evento de origen (de donde sale el contenido del mensaje). */
export interface AvisoReclamado {
  id: string;
  tipo: TipoAviso;
  destinatario: Destinatario;
  citaId: string | null;
  intentos: number;
  descartarDespues: Date;
  /** Null si el evento de origen ya no existe (purgado): el aviso no se puede componer. */
  evento: { tipo: string; payload: Record<string, unknown> } | null;
}

/**
 * Avisos de la barbería del contexto (tabla `notification`, RLS por tenant), en la transacción en curso.
 * Toda escritura sobre un aviso reclamado es condicional a que siga `ENVIANDO`.
 */
export abstract class AvisoRepository {
  /**
   * Alta de los avisos de un evento: uno por destinatario. Si ya existían (el mismo evento despachado otra
   * vez), no crea otro (UNIQUE por evento y destinatario, FR-012). Devuelve cuántos creó.
   */
  abstract crear(avisos: readonly NuevoAviso[]): Promise<number>;
  /**
   * Reclama el aviso para enviarlo (`FOR UPDATE SKIP LOCKED`): si está PENDIENTE y ya toca, o ENVIANDO con el
   * reclamo vencido (una réplica cayó), pasa a ENVIANDO con `claimed_until = ahora + plazo`. Null si otra réplica
   * lo tiene o ya no hay nada que enviar.
   */
  abstract reclamar(id: string, ahora: Date, plazoMs: number): Promise<AvisoReclamado | null>;
  abstract marcarEnviado(id: string, canal: CanalDeAviso, ahora: Date): Promise<void>;
  /** Vuelve a PENDIENTE para otro intento. */
  abstract reintentar(
    id: string,
    intentos: number,
    proximoIntento: Date,
    error: CodigoErrorAviso,
  ): Promise<void>;
  /** Estado final. Con `error` undefined se conserva el último error anotado. */
  abstract finalizar(
    id: string,
    estado: 'FALLIDO' | 'DESCARTADO',
    intentos: number,
    error?: CodigoErrorAviso | null,
  ): Promise<void>;
  /**
   * R09: descarta los recordatorios PENDIENTES de una cita cancelada o reprogramada (los crea la fase 4; hasta
   * entonces no hay ninguno). Devuelve cuántos descartó.
   */
  abstract descartarRecordatoriosDe(citaId: string): Promise<number>;
  /** Retención (R17): borra hasta `lote` avisos en estado final creados antes de `limite`. */
  abstract purgar(limite: Date, lote: number): Promise<number>;
}

export interface AvisoPorEnviar {
  id: string;
  tenantId: string;
}

/**
 * Lectura entre barberías con el rol barberias_plataforma (research R08; constitución 1.4.1, tercera excepción):
 * solo las cinco columnas técnicas de `notification`. Cada aviso se procesa después con su tenant y el rol de la
 * aplicación.
 */
export abstract class PendientesDeAvisos {
  /** Avisos que toca enviar: PENDIENTES sin espera, o ENVIANDO con el reclamo vencido. */
  abstract listar(ahora: Date, limite: number): Promise<AvisoPorEnviar[]>;
  /**
   * Barberías con avisos en estado final (candidatas a la purga). El rol no lee `created_at`: la purga filtra por
   * la antigüedad dentro de cada barbería, con RLS.
   */
  abstract barberiasConFinales(maximo: number): Promise<string[]>;
}
