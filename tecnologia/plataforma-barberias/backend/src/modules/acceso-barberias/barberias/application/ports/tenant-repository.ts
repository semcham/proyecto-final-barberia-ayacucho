import type { Barberia, EstadoBarberia } from '../../domain/barberia';

/** Barberías (tabla global `tenant`). */
export abstract class TenantRepository {
  /**
   * Inserta la barbería. Si su slug ya está ocupado, prueba con sufijos aleatorios y actualiza la
   * barbería con el slug que quedó guardado.
   */
  abstract insertar(barberia: Barberia): Promise<void>;
  abstract estado(id: string): Promise<EstadoBarberia | null>;
}
