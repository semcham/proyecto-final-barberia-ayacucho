import type { HorarioSemanal } from '../../../../../shared';
import type { Barbero } from '../../domain/barbero';
import type { Bloqueo } from '../../domain/bloqueo';
import type { Servicio } from '../../domain/servicio';

// T054 · Puertos del catálogo (US1). Todas las implementaciones trabajan en la transacción del caso de uso,
// con el tenant del token fijado (RLS), y filtran además por el tenant del contexto (principio III).

export abstract class ServicioRepository {
  /** Activos e inactivos, por nombre. */
  abstract listar(): Promise<Servicio[]>;
  abstract porId(id: string): Promise<Servicio | null>;
  /** De los ids dados, los que existen en la barbería. */
  abstract existentes(ids: readonly string[]): Promise<string[]>;
  /** Lanza `NombreDuplicado` si ya hay otro servicio con ese nombre (sin distinguir mayúsculas). */
  abstract crear(servicio: Servicio): Promise<void>;
  /** Lanza `NombreDuplicado` como `crear`. */
  abstract actualizar(servicio: Servicio): Promise<void>;
  /**
   * 011: de los nombres dados, las claves (`claveDeNombre`) de los que ya usa un servicio de la barbería, activo o no
   * (la misma comparación que el índice `service_nombre_unico`).
   */
  abstract nombresExistentes(nombres: readonly string[]): Promise<Set<string>>;
  /** 011: crea varios en una sola instrucción. Lanza `NombreDuplicado` como `crear` (y no crea ninguno). */
  abstract crearVarios(servicios: readonly Servicio[]): Promise<void>;
}

/** 011 (research R06): una carga en lote ya guardada, para responder igual a sus reintentos. */
export interface CargaGuardada {
  id: string;
  autorId: string;
  clave: string;
  tipo: 'SERVICIOS' | 'BARBEROS';
  huella: string;
  ids: string[];
}

/** La clave ya la usó otra carga del mismo autor, guardada mientras esta se procesaba (índice único). */
export class ClaveDeCargaEnUso extends Error {
  constructor() {
    super('La clave de idempotencia de la carga ya está en uso');
    this.name = 'ClaveDeCargaEnUso';
  }
}

/** 011 · Cargas en lote guardadas (tabla catalog_batch), en la transacción del caso de uso. */
export abstract class CargaLoteRepository {
  abstract buscar(autorId: string, clave: string): Promise<CargaGuardada | null>;
  /** Lanza `ClaveDeCargaEnUso` si el autor ya guardó una carga con esa clave. */
  abstract guardar(carga: CargaGuardada): Promise<void>;
}

export abstract class BarberoRepository {
  /** Activos e inactivos, con sus servicios, por nombre. */
  abstract listar(): Promise<Barbero[]>;
  abstract porId(id: string): Promise<Barbero | null>;
  /** El barbero vinculado a un usuario, o null. */
  abstract porUsuario(usuarioId: string): Promise<Barbero | null>;
  abstract contarActivos(): Promise<number>;
  /** Lanza `UsuarioYaVinculado` si el usuario ya está vinculado a otro barbero. */
  abstract crear(barbero: Barbero): Promise<void>;
  /** Guarda nombre, vínculo, estado y reemplaza los servicios. Lanza `UsuarioYaVinculado` como `crear`. */
  abstract actualizar(barbero: Barbero): Promise<void>;
}

/** Horario de atención de la barbería y disponibilidad de cada barbero: se reemplaza la semana completa. */
export abstract class HorarioRepository {
  abstract atencion(): Promise<HorarioSemanal>;
  abstract reemplazarAtencion(horario: HorarioSemanal): Promise<void>;
  abstract disponibilidad(barberoId: string): Promise<HorarioSemanal>;
  abstract reemplazarDisponibilidad(barberoId: string, horario: HorarioSemanal): Promise<void>;
}

export abstract class BloqueoRepository {
  /** Bloqueos del barbero que terminan después de `desde`, por inicio. */
  abstract futuros(barberoId: string, desde: Date): Promise<Bloqueo[]>;
  abstract porId(barberoId: string, id: string): Promise<Bloqueo | null>;
  abstract crear(bloqueo: Bloqueo): Promise<void>;
  abstract eliminar(id: string): Promise<void>;
}

/** Cita activa (PENDIENTE o CONFIRMADA) afectada por un cambio del catálogo. Sin datos del cliente. */
export interface CitaActiva {
  id: string;
  barberoId: string;
  /** Nombre del servicio copiado en la cita. */
  servicio: string;
  inicio: Date;
  fin: Date;
}

/**
 * Citas activas que un cambio del catálogo puede dejar en conflicto (R11). Lee `appointment`, del mismo
 * módulo (M02).
 */
export abstract class CitasActivasQuery {
  /** Del barbero, que se solapan con [desde, hasta). */
  abstract deBarberoEnRango(barberoId: string, desde: Date, hasta: Date): Promise<CitaActiva[]>;
  /** Que empiezan desde `desde`; opcionalmente de un barbero o de un servicio. */
  abstract futuras(filtro: { barberoId?: string; servicioId?: string }, desde: Date): Promise<CitaActiva[]>;
}
