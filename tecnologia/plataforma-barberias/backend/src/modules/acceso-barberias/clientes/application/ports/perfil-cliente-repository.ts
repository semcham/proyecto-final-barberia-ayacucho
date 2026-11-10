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
  /**
   * 004: el correo del perfil (o, si no lo tiene, el de su cuenta) en la barbería del contexto; `{ correo: null }`
   * para un cliente presencial sin correo; null si el perfil no existe en esta barbería.
   */
  abstract correoDe(clienteId: string): Promise<{ correo: string | null } | null>;
  /** Varios perfiles de la barbería del contexto en una consulta; ignora ids de otras barberías. */
  abstract varios(clienteIds: readonly string[]): Promise<PerfilClienteResumen[]>;
  /**
   * Clientes de la barbería del contexto cuyo nombre contiene `texto` (sin distinguir mayúsculas) o cuyo
   * teléfono contiene sus dígitos, por nombre, como máximo `limite`.
   */
  abstract buscar(texto: string, limite: number): Promise<ClienteEncontrado[]>;
}

export interface ClienteEncontrado {
  id: string;
  nombre: string;
  telefono: string;
  origen: 'EN_LINEA' | 'PRESENCIAL';
}
