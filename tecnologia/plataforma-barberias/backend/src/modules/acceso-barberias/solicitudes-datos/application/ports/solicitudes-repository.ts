import type { EstadoSolicitud, SolicitudDatos, TipoSolicitud, Titular } from '../../domain/solicitud-datos';

/** El titular como lo ve el propietario en su bandeja (ya ve a sus clientes y barberos). */
export interface TitularEnBandeja {
  tipo: 'CLIENTE' | 'BARBERO';
  nombre: string;
}

export interface SolicitudConTitular {
  solicitud: SolicitudDatos;
  titular: TitularEnBandeja;
}

/** Filtro de la bandeja: las abiertas (RECIBIDA y EN_ATENCION) o un estado. */
export type FiltroBandeja = 'ABIERTAS' | EstadoSolicitud;

/**
 * T011 de 007 · Solicitudes sobre datos personales de la barbería del contexto. Todas las consultas van en la
 * transacción en curso, con el tenant del token fijado (RLS) y además filtradas por ese tenant (principio III).
 */
export abstract class SolicitudesRepository {
  /**
   * Inserta la solicitud. Si ya hay una abierta del mismo tipo para ese titular (índice único parcial, también con
   * dos registros simultáneos), lanza `SolicitudAbierta` con el id de la existente.
   */
  abstract crear(solicitud: SolicitudDatos): Promise<void>;
  /** Id de la abierta del mismo tipo para ese titular, o null. */
  abstract abiertaDe(tipo: TipoSolicitud, titular: Titular): Promise<string | null>;
  /** La solicitud con su fila bloqueada (FOR UPDATE) para una transición, o null si no es de esta barbería. */
  abstract paraActualizar(id: string): Promise<SolicitudDatos | null>;
  /** Guarda el estado, la respuesta, el motivo y las fechas de la transición (las únicas columnas que cambian). */
  abstract guardarTransicion(solicitud: SolicitudDatos): Promise<void>;
  /** Las del titular, de la más antigua a la más reciente. */
  abstract delTitular(titular: Titular): Promise<SolicitudDatos[]>;
  /** La bandeja del propietario, de la más antigua a la más reciente, con el titular. */
  abstract bandeja(filtro: FiltroBandeja): Promise<SolicitudConTitular[]>;
  /** Una solicitud con su titular, o null. */
  abstract conTitular(id: string): Promise<SolicitudConTitular | null>;
}
