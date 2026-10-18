import type { PerfilClienteResumen } from '../../../api-publica';
import type { PerfilCliente } from '../../domain/perfil-cliente';

/**
 * Perfiles de cliente de la barbería del contexto (tabla `customer_profile`, RLS por tenant): alta (US3) y
 * las lecturas que usa M02 por `ClientesApi`.
 */
export abstract class PerfilClienteRepository {
  /** Inserta el perfil en la barbería del contexto (el perfil debe ser de ese tenant). */
  abstract crear(perfil: PerfilCliente): Promise<void>;
  /** Perfil de la cuenta `usuarioId` en la barbería del contexto, o null. */
  abstract porUsuario(usuarioId: string): Promise<PerfilClienteResumen | null>;
  /** Perfil por su id (con cuenta o presencial) en la barbería del contexto, o null. */
  abstract porId(clienteId: string): Promise<PerfilClienteResumen | null>;
  /** Varios perfiles de la barbería del contexto en una consulta; ignora ids de otras barberías. */
  abstract varios(clienteIds: readonly string[]): Promise<PerfilClienteResumen[]>;
}
