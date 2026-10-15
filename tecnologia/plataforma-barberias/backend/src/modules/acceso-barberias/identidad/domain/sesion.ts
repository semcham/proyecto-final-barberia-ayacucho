import { OperacionNoPermitida } from './errores';

const DIA_MS = 24 * 60 * 60 * 1000;
export const VIDA_DESLIZANTE_MS = 7 * DIA_MS;
export const VIDA_ABSOLUTA_MS = 30 * DIA_MS;
export const RETENCION_MS = 30 * DIA_MS;

export type EstadoSesion = 'ACTIVA' | 'CERRADA' | 'REVOCADA';

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
}

/**
 * Sesión de un usuario (R08): 7 días deslizantes con tope absoluto de 30. El token de renovación rota en
 * cada uso; si llega uno ya rotado, se considera reutilización y la sesión se revoca.
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

  estaVigente(ahora: Date): boolean {
    return this.datos.estado === 'ACTIVA' && ahora.getTime() < this.finPorTiempo().getTime();
  }

  /** Renueva la sesión con un token nuevo; el anterior queda guardado para detectar su reutilización. */
  rotar(nuevoHash: string, ahora: Date): void {
    if (!this.estaVigente(ahora)) throw new OperacionNoPermitida('La sesión no está vigente.');
    this.datos.hashTokenAnterior = this.datos.hashTokenVigente;
    this.datos.hashTokenVigente = nuevoHash;
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
