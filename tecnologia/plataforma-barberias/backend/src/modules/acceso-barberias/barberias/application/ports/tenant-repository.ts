import type { ConfiguracionAgenda, DatosPublicosBarberia } from '../../../api-publica';
import type { Barberia, EstadoBarberia } from '../../domain/barberia';

/** Configuración editable de la barbería (esquema BarberiaConfig del contrato de 002). */
export interface ConfiguracionBarberia {
  nombre: string;
  slug: string;
  direccion: string | null;
  telefono: string | null;
  descripcion: string | null;
  zonaHoraria: string;
  antelacionCancelacionMinutos: number;
}

export type CambiosBarberia = Partial<Omit<ConfiguracionBarberia, 'zonaHoraria'>>;

/** Barberías (tabla global `tenant`). */
export abstract class TenantRepository {
  /** Configuración de una barbería, o null. */
  abstract configuracion(id: string): Promise<ConfiguracionBarberia | null>;
  /**
   * Actualiza la barbería del contexto (política `tenant_edicion`: solo la del tenant de la transacción).
   * Lanza `EnlaceNoDisponible` si el enlace ya lo usa otra barbería.
   */
  abstract actualizar(id: string, cambios: CambiosBarberia): Promise<void>;
  /**
   * Inserta la barbería. Si su slug ya está ocupado, prueba con sufijos aleatorios y actualiza la
   * barbería con el slug que quedó guardado.
   */
  abstract insertar(barberia: Barberia): Promise<void>;
  abstract estado(id: string): Promise<EstadoBarberia | null>;
  /**
   * US5 de 003 (FR-034, H5): cambia `tenant.status` de la barbería del contexto, solo si sigue en `desde`
   * (transición condicional; la política tenant_edicion impide tocar otra). Devuelve si se aplicó. Solo lo usan
   * los casos de uso del administrador: ninguna ruta del propietario cambia el estado.
   */
  abstract cambiarEstado(id: string, desde: EstadoBarberia, hacia: EstadoBarberia): Promise<boolean>;
  /** Id de la barbería ACTIVA con ese slug, o null (inexistente o suspendida). */
  abstract idActivaPorSlug(slug: string): Promise<string | null>;
  /** Datos públicos de una barbería ACTIVA, o null. */
  abstract datosPublicos(id: string): Promise<DatosPublicosBarberia | null>;
  /** Id y datos públicos de la barbería ACTIVA con ese slug, en una sola consulta (006 R07), o null. */
  abstract datosPublicosPorSlug(
    slug: string,
  ): Promise<{ id: string; barberia: DatosPublicosBarberia } | null>;
  /** Zona horaria y antelación de cancelación de una barbería. */
  abstract configuracionAgenda(id: string): Promise<ConfiguracionAgenda | null>;
}
