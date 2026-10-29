// Puertos del acceso del administrador de la plataforma (ADR-031, R07; constitución 1.3.1). Las tablas de la
// plataforma no tienen barbería: todo corre sin tenant.

/** Administrador tal como lo lee el rol barberias_plataforma (el de la aplicación no ve platform_admin, C3). */
export interface AdminPlataforma {
  id: string;
  correo: string;
  hashContrasena: string;
  secretoCifrado: Buffer;
  hashesRecuperacion: string[];
  activo: boolean;
}

/** Lectura del administrador con LecturaPlataforma (solo lectura). */
export abstract class AdminsPlataforma {
  abstract porCorreo(correo: string): Promise<AdminPlataforma | null>;
  abstract porId(id: string): Promise<AdminPlataforma | null>;
}

/** Vigencia de la sesión del token de plataforma, en cada solicitud (sesión ACTIVA, no vencida, cuenta activa). */
export abstract class SesionesPlataformaVigentes {
  abstract vigente(sesionId: string, adminId: string, ahora: Date): Promise<boolean>;
}

export interface DesafioPlataforma {
  id: string;
  adminId: string;
  expiraEn: Date;
  usadoEn: Date | null;
}

export interface SesionPlataforma {
  id: string;
  adminId: string;
  estado: 'ACTIVA' | 'CERRADA' | 'REVOCADA';
  expiraEn: Date;
  /** Cuál de los dos hashes coincidió con el token presentado. */
  coincide: 'ACTUAL' | 'ANTERIOR';
}

/** El código de recuperación ya se usó en otro ingreso (UNIQUE (admin_id, used_recovery_index)). */
export class CodigoRecuperacionYaUsado extends Error {
  constructor() {
    super('El código de recuperación ya se usó');
    this.name = 'CodigoRecuperacionYaUsado';
  }
}

/**
 * Desafíos y sesiones de la plataforma, escritos con el rol de la aplicación dentro de
 * `UnitOfWork.ejecutarSinTenant` (constitución 1.3.1: el rol tiene SELECT e INSERT y UPDATE por columna).
 */
export abstract class AccesoPlataformaRepository {
  abstract crearDesafio(desafio: {
    id: string;
    adminId: string;
    creadoEn: Date;
    expiraEn: Date;
  }): Promise<void>;
  abstract desafio(id: string): Promise<DesafioPlataforma | null>;
  /**
   * Marca el desafío como usado si sigue sin usar (transición condicional). Con un código de recuperación,
   * guarda su índice; si ese índice ya lo usó otro ingreso, lanza CodigoRecuperacionYaUsado.
   */
  abstract usarDesafio(id: string, ahora: Date, indiceRecuperacion: number | null): Promise<boolean>;
  abstract indicesRecuperacionUsados(adminId: string): Promise<Set<number>>;
  /** Mayor paso TOTP con el que entró el administrador, o null si nunca entró con TOTP. */
  abstract ultimoPaso(adminId: string): Promise<number | null>;
  /**
   * Abre la sesión. Devuelve false si ya hay una abierta con ese mismo paso TOTP (dos ingresos simultáneos
   * con el mismo código: UNIQUE (admin_id, totp_step)).
   */
  abstract crearSesion(sesion: {
    id: string;
    adminId: string;
    hashRenovacion: string;
    paso: number | null;
    creadaEn: Date;
    expiraEn: Date;
  }): Promise<boolean>;
  /** Busca la sesión por el hash actual o el anterior del token de renovación y bloquea la fila. */
  abstract bloquearSesionPorHash(hash: string): Promise<SesionPlataforma | null>;
  abstract rotarSesion(id: string, hashNuevo: string, hashAnterior: string, ahora: Date): Promise<void>;
  /** Cierra o revoca la sesión si sigue activa. */
  abstract terminarSesion(
    id: string,
    adminId: string,
    estado: 'CERRADA' | 'REVOCADA',
    ahora: Date,
  ): Promise<boolean>;
}

export type AccionAccesoAdmin =
  | 'ADMIN_INGRESO'
  | 'ADMIN_INGRESO_FALLIDO'
  | 'ADMIN_SEGUNDO_FACTOR_FALLIDO'
  | 'ADMIN_CODIGO_RECUPERACION_USADO'
  | 'ADMIN_SALIDA';

/** platform_audit_log: quién, qué, resultado, IP y cuándo. Nunca códigos, secretos ni contraseñas. */
export abstract class AuditoriaAccesoPlataforma {
  abstract registrar(entrada: {
    accion: AccionAccesoAdmin;
    adminId: string | null;
    resultado: 'PERMITIDO' | 'DENEGADO';
  }): Promise<void>;
}
