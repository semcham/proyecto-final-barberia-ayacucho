import type { DatosSolicitud } from '../../../../../shared';
import type { AceptacionTerminos } from '../../domain/aceptacion-terminos';

/** Evidencias de aceptación del tenant del contexto. */
export abstract class TermsAcceptanceRepository {
  abstract registrar(
    usuarioId: string,
    aceptacion: AceptacionTerminos,
    solicitud: DatosSolicitud,
  ): Promise<void>;
}
