import type { Consentimiento } from '../../domain/consentimiento';

/** Evidencia de consentimientos de la barbería del contexto (tabla `consent_record`, inmutable). */
export abstract class ConsentimientoRepository {
  abstract registrar(clienteId: string, consentimiento: Consentimiento, ip: string | null): Promise<void>;
}
