import type { ConsentimientoVigente } from '../../domain/consentimiento-whatsapp';

/**
 * T117 de 004 · Consentimientos para WhatsApp de la barbería del contexto (`whatsapp_consent`, RLS por tenant;
 * data-model §2.2). La evidencia se conserva: no hay borrado, el retiro solo fija `withdrawn_at`.
 */
export abstract class ConsentimientoWhatsappRepository {
  /** El consentimiento vigente (sin retirar) del cliente, o null. Hay como máximo uno (índice único parcial). */
  abstract vigente(clienteId: string): Promise<ConsentimientoVigente | null>;
  abstract registrar(
    clienteId: string,
    consentimiento: { id: string; numero: string; version: string; en: Date },
  ): Promise<void>;
  abstract retirar(id: string, en: Date): Promise<void>;
}
