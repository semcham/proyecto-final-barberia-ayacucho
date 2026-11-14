import {
  AIProvider,
  type Interpretacion,
  ProveedorIANoDisponible,
  type SolicitudDeInterpretacion,
} from '../application/ports/ai-provider';

/**
 * T011 de 005 · Sin proveedor configurado (IA_PROVEEDOR=ninguno, el valor por defecto, ADR-027): el asistente
 * responde siempre "no disponible" con la alternativa manual, y el resto de la plataforma sigue igual.
 */
export class ProveedorIANinguno extends AIProvider {
  interpretar(_solicitud: SolicitudDeInterpretacion, _senal: AbortSignal): Promise<Interpretacion> {
    return Promise.reject(new ProveedorIANoDisponible('SIN_PROVEEDOR'));
  }
}
