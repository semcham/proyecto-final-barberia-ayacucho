import type { DatosSolicitud } from '../../../../../shared';
import type { CodigoRol } from '../../domain/rol';
import type { EstadoSesion, Sesion } from '../../domain/sesion';

/** Resultado de buscar una sesión por el hash de su token, antes de conocer el tenant (ADR-015). */
export interface SesionPorHash {
  sesionId: string;
  tenantId: string;
  usuarioId: string;
  estado: EstadoSesion;
  esTokenAnterior: boolean;
}

/** Lo que el guard necesita saber para aceptar una solicitud (R09). */
export interface EstadoDeAcceso {
  sesion: Sesion;
  rolMembresia: CodigoRol;
  membresiaActiva: boolean;
  barberiaActiva: boolean;
}

/**
 * Sesiones del tenant del contexto. Toda operación filtra por ese tenant además de RLS (principio III),
 * salvo `buscarPorHash`, que usa la función auth_buscar_sesion (ADR-015).
 */
export abstract class SesionRepository {
  abstract crear(sesion: Sesion, metadatos: DatosSolicitud): Promise<void>;
  abstract obtener(sesionId: string): Promise<Sesion | null>;
  abstract guardar(sesion: Sesion): Promise<void>;
  abstract revocarTodasDe(usuarioId: string, ahora: Date): Promise<void>;
  /** Borra las sesiones del usuario terminadas (cerradas, revocadas o vencidas) hace más de 30 días (R08). */
  abstract purgarTerminadasDe(usuarioId: string, ahora: Date): Promise<number>;
  abstract buscarPorHash(hashToken: string): Promise<SesionPorHash | null>;
  abstract estadoDeAcceso(sesionId: string, usuarioId: string): Promise<EstadoDeAcceso | null>;
  /**
   * Como `estadoDeAcceso`, pero bloquea la fila de la sesión (`FOR UPDATE`) hasta el fin de la transacción:
   * dos renovaciones con el mismo token se atienden una tras otra (FR-008a).
   */
  abstract bloquearParaRenovar(sesionId: string, usuarioId: string): Promise<EstadoDeAcceso | null>;
}
