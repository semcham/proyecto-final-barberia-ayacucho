import type { TenantId } from '../../shared';
import type { HorariosLibresVista } from './catalogo/application/consultar-horarios';
import type { ServicioPublico } from './catalogo/application/ports/catalog-query';
import type {
  ActividadDeCitas,
  ConteosDeCitas,
  ServicioSolicitado,
} from './citas/application/ports/reportes-de-citas';

// T009 de 005 · Interfaz pública de M02 para M04 (research R01), SOLO DE LECTURA: una prueba de arquitectura exige
// que tenga exactamente estos siete métodos (catalogo-citas-api-solo-lectura.spec.ts). Devuelve solo datos públicos
// del catálogo y de los horarios, y conteos sin datos de clientes. No pasa por la autorización de M02 (el CLIENTE no
// tiene VER_CATALOGO): el permiso lo da la matriz de M04 (USAR_ASISTENTE y la operación del rol, o VER_REPORTES).
// La implementación es catalogo/application/catalogo-citas-api-impl.ts. No cambia ninguna ruta ni caso de uso.

export type { ServicioPublico } from './catalogo/application/ports/catalog-query';
export type { HorariosLibresVista } from './catalogo/application/consultar-horarios';
export type {
  ActividadDeCitas,
  ConteosDeCitas,
  ServicioSolicitado,
} from './citas/application/ports/reportes-de-citas';

/** Lo que el asistente necesita saber de la barbería: su nombre, su zona horaria y su enlace público. */
export interface ContextoDeLaBarberia {
  nombre: string;
  zonaHoraria: string;
  slug: string;
}

export interface BarberoVisible {
  barberoId: string;
  /** Nombre visible del catálogo. */
  nombre: string;
}

export interface ConsultaDeHorariosLibres {
  servicioId: string;
  /** Fecha local de la barbería, YYYY-MM-DD. */
  fecha: string;
  barberoId?: string;
}

export abstract class CatalogoCitasApi {
  /**
   * Nombre, zona horaria y slug de la barbería. Es la única lectura que NO corre en la transacción del llamador:
   * `tenant` es una tabla global que M01 lee sin tenant, así que se llama ANTES de abrir la transacción (si ya hay
   * una en curso, falla).
   */
  abstract contextoDeLaBarberia(tenantId: TenantId): Promise<ContextoDeLaBarberia>;
  /** Servicios activos con nombre, precio, duración y descripción pública (los del catálogo público de 002). */
  abstract serviciosActivos(): Promise<ServicioPublico[]>;
  /** Barberos activos que atienden el servicio, por nombre. Vacío si el servicio no es de la barbería. */
  abstract barberosQueOfrecen(servicioId: string): Promise<BarberoVisible[]>;
  /** El mismo cálculo que GET /horarios con sesión (ConsultarHorarios), con la zona de la barbería. */
  abstract horariosLibres(consulta: ConsultaDeHorariosLibres): Promise<HorariosLibresVista>;
  /** Citas con inicio en [inicio, fin), por estado. */
  abstract conteosDeCitas(inicio: Date, fin: Date): Promise<ConteosDeCitas>;
  /** Servicios con más citas no canceladas en [inicio, fin), hasta `limite`. */
  abstract serviciosMasSolicitados(inicio: Date, fin: Date, limite: number): Promise<ServicioSolicitado[]>;
  /** Citas por barbero y por día de la semana local, y los totales de tardías y no asistió, en [inicio, fin). */
  abstract actividad(inicio: Date, fin: Date): Promise<ActividadDeCitas>;
}
