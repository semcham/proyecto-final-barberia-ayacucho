import { OperacionNoPermitida } from './errores';

const DIA_MS = 24 * 60 * 60 * 1000;
export const VIDA_DESLIZANTE_MS = 7 * DIA_MS;
export const VIDA_ABSOLUTA_MS = 30 * DIA_MS;
export const RETENCION_MS = 30 * DIA_MS;

export type EstadoSesion = 'ACTIVA' | 'CERRADA' | 'REVOCADA';

/**
 * Cómo se trata un token de renovación presentado (FR-008a):
 * - VIGENTE: rotación normal.
 * - GRACIA: es el anterior, dentro de la ventana y sin gracia usada: se acepta una vez.
 * - REUTILIZADO: el anterior fuera de la ventana o por segunda vez, o el token reemplazado: posible robo.
 * - DESCONOCIDO: no corresponde a esta sesión.
 */
export type ClaseToken = 'VIGENTE' | 'GRACIA' | 'REUTILIZADO' | 'DESCONOCIDO';

export interface DatosSesion {
  id: string;
  tenantId: string;
  usuarioId: string;
  hashTokenVigente: string;
  hashTokenAnterior: string | null;
  estado: EstadoSesion;
  creadaEn: Date;
  ultimoUsoEn: Date;
  venceAbsolutoEn: Date;
  terminadaEn: Date | null;
  /** Cuándo el token vigente reemplazó al anterior: inicio del período de gracia. */
  rotadaEn: Date | null;
  /** Cuándo se aceptó el token anterior dentro del período de gracia (un solo uso). */
  graciaUsadaEn: Date | null;
  /** Token vigente que el uso de la gracia dejó sin efecto. */
  hashTokenReemplazado: string | null;
}

/**
 * Sesión de un usuario (R08): 7 días deslizantes con tope absoluto de 30. El token de renovación rota en
 * cada uso; si llega uno ya rotado, se considera reutilización y la sesión se revoca, salvo un único uso
 * del token anterior dentro del período de gracia (FR-008a, R23).
 */
export class Sesion {
  private constructor(private datos: DatosSesion) {}

  static iniciar(id: string, tenantId: string, usuarioId: string, hashToken: string, ahora: Date): Sesion {
    return new Sesion({
      id,
      tenantId,
      usuarioId,
      hashTokenVigente: hashToken,
      hashTokenAnterior: null,
      estado: 'ACTIVA',
      creadaEn: ahora,
      ultimoUsoEn: ahora,
      venceAbsolutoEn: new Date(ahora.getTime() + VIDA_ABSOLUTA_MS),
      terminadaEn: null,
      rotadaEn: null,
      graciaUsadaEn: null,
      hashTokenReemplazado: null,
    });
  }

  static reconstruir(datos: DatosSesion): Sesion {
    return new Sesion({ ...datos });
  }

  get id(): string {
    return this.datos.id;
  }
  get tenantId(): string {
    return this.datos.tenantId;
  }
  get usuarioId(): string {
    return this.datos.usuarioId;
  }
  get estado(): EstadoSesion {
    return this.datos.estado;
  }
  get hashTokenVigente(): string {
    return this.datos.hashTokenVigente;
  }
  get hashTokenAnterior(): string | null {
    return this.datos.hashTokenAnterior;
  }
  get ultimoUsoEn(): Date {
    return this.datos.ultimoUsoEn;
  }
  get venceAbsolutoEn(): Date {
    return this.datos.venceAbsolutoEn;
  }
  get terminadaEn(): Date | null {
    return this.datos.terminadaEn;
  }
  get creadaEn(): Date {
    return this.datos.creadaEn;
  }
  get rotadaEn(): Date | null {
    return this.datos.rotadaEn;
  }
  get graciaUsadaEn(): Date | null {
    return this.datos.graciaUsadaEn;
  }
  get hashTokenReemplazado(): string | null {
    return this.datos.hashTokenReemplazado;
  }

  estaVigente(ahora: Date): boolean {
    return this.datos.estado === 'ACTIVA' && ahora.getTime() < this.finPorTiempo().getTime();
  }

  /** Renueva la sesión con un token nuevo; el anterior queda guardado para detectar su reutilización. */
  rotar(nuevoHash: string, ahora: Date): void {
    if (!this.estaVigente(ahora)) throw new OperacionNoPermitida('La sesión no está vigente.');
    this.datos.hashTokenAnterior = this.datos.hashTokenVigente;
    this.datos.hashTokenVigente = nuevoHash;
    this.datos.ultimoUsoEn = ahora;
    // Empieza un período de gracia nuevo para el token que acaba de quedar como anterior.
    this.datos.rotadaEn = ahora;
    this.datos.graciaUsadaEn = null;
    this.datos.hashTokenReemplazado = null;
  }

  /**
   * Clasifica un token presentado (FR-008a). Con graciaMs = 0 no hay período de gracia: el anterior es
   * siempre una reutilización (comportamiento previo).
   */
  clasificarToken(hash: string, ahora: Date, graciaMs: number): ClaseToken {
    if (hash === this.datos.hashTokenVigente) return 'VIGENTE';
    if (this.datos.hashTokenReemplazado !== null && hash === this.datos.hashTokenReemplazado) {
      return 'REUTILIZADO';
    }
    if (!this.esTokenAnterior(hash)) return 'DESCONOCIDO';
    const rotada = this.datos.rotadaEn;
    const dentroDeLaVentana =
      graciaMs > 0 && rotada !== null && ahora.getTime() - rotada.getTime() <= graciaMs;
    return dentroDeLaVentana && this.datos.graciaUsadaEn === null ? 'GRACIA' : 'REUTILIZADO';
  }

  /**
   * Acepta el token anterior dentro del período de gracia: emite uno nuevo y deja sin efecto el vigente
   * (si aparece después, es una reutilización). No extiende la ventana y no puede repetirse.
   */
  rotarEnGracia(nuevoHash: string, ahora: Date): void {
    if (!this.estaVigente(ahora)) throw new OperacionNoPermitida('La sesión no está vigente.');
    if (this.datos.graciaUsadaEn !== null) {
      throw new OperacionNoPermitida('El período de gracia ya se usó.');
    }
    this.datos.hashTokenReemplazado = this.datos.hashTokenVigente;
    this.datos.hashTokenVigente = nuevoHash;
    this.datos.graciaUsadaEn = ahora;
    this.datos.ultimoUsoEn = ahora;
  }

  /** ¿El hash corresponde al token ya rotado? Indica un posible robo del token de renovación. */
  esTokenAnterior(hash: string): boolean {
    return this.datos.hashTokenAnterior !== null && this.datos.hashTokenAnterior === hash;
  }

  /** Cierre de sesión por el usuario. Idempotente si ya terminó. */
  cerrar(ahora: Date): void {
    if (this.datos.estado !== 'ACTIVA') return;
    this.datos.estado = 'CERRADA';
    this.datos.terminadaEn = ahora;
  }

  /** Revocación por reutilización del token o porque el usuario fue desactivado. Idempotente. */
  revocar(ahora: Date): void {
    if (this.datos.estado !== 'ACTIVA') return;
    this.datos.estado = 'REVOCADA';
    this.datos.terminadaEn = ahora;
  }

  /** Retención (R08): se borra cuando terminó (cerrada, revocada o vencida) hace más de 30 días. */
  debePurgarse(ahora: Date): boolean {
    const fin = this.datos.terminadaEn ?? (this.estaVigente(ahora) ? null : this.finPorTiempo());
    return fin !== null && ahora.getTime() - fin.getTime() > RETENCION_MS;
  }

  private finPorTiempo(): Date {
    const deslizante = this.datos.ultimoUsoEn.getTime() + VIDA_DESLIZANTE_MS;
    return new Date(Math.min(deslizante, this.datos.venceAbsolutoEn.getTime()));
  }
}
