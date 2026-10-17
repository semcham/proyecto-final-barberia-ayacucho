import type { ConfiguracionAgenda, DatosPublicosBarberia } from '../../../api-publica';
import type { Barberia, EstadoBarberia } from '../../domain/barberia';

/** Barberías (tabla global `tenant`). */
export abstract class TenantRepository {
  /**
   * Inserta la barbería. Si su slug ya está ocupado, prueba con sufijos aleatorios y actualiza la
   * barbería con el slug que quedó guardado.
   */
  abstract insertar(barberia: Barberia): Promise<void>;
  abstract estado(id: string): Promise<EstadoBarberia | null>;
  /** Id de la barbería ACTIVA con ese slug, o null (inexistente o suspendida). */
  abstract idActivaPorSlug(slug: string): Promise<string | null>;
  /** Datos públicos de una barbería ACTIVA, o null. */
  abstract datosPublicos(id: string): Promise<DatosPublicosBarberia | null>;
  /** Zona horaria y antelación de cancelación de una barbería. */
  abstract configuracionAgenda(id: string): Promise<ConfiguracionAgenda | null>;
}
