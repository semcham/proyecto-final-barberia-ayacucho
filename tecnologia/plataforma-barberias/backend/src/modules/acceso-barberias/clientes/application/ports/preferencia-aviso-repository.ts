import type { PreferenciaAviso } from '../../domain/preferencia-aviso';

/**
 * T117 de 004 · Canal de aviso de los clientes de la barbería del contexto (`customer_notification_preference`, RLS
 * por tenant; data-model §2.1). Sin fila, el canal es el correo.
 */
export abstract class PreferenciaAvisoRepository {
  /** La preferencia guardada del cliente, o null (el canal por defecto: correo). */
  abstract obtener(clienteId: string): Promise<PreferenciaAviso | null>;
  /** Crea o actualiza la preferencia del cliente. */
  abstract guardar(clienteId: string, preferencia: PreferenciaAviso): Promise<void>;
}
