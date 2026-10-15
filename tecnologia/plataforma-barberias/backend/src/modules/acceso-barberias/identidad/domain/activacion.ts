import { EnlaceInvalido } from './errores';

const VIGENCIA_MS = 72 * 60 * 60 * 1000;

export interface DatosActivacion {
  id: string;
  tenantId: string;
  usuarioId: string;
  venceEn: Date;
  usadaEn: Date | null;
  revocadaEn: Date | null;
}

/**
 * Enlace de activación de cuenta (R14, FR-022): de un solo uso, vence a las 72 h y queda revocado si el
 * propietario genera uno nuevo. El token solo existe en el enlace; se guarda únicamente su hash.
 */
export class Activacion {
  private constructor(private datos: DatosActivacion) {}

  static crear(id: string, tenantId: string, usuarioId: string, ahora: Date): Activacion {
    return new Activacion({
      id,
      tenantId,
      usuarioId,
      venceEn: new Date(ahora.getTime() + VIGENCIA_MS),
      usadaEn: null,
      revocadaEn: null,
    });
  }

  static reconstruir(datos: DatosActivacion): Activacion {
    return new Activacion({ ...datos });
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
  get venceEn(): Date {
    return this.datos.venceEn;
  }
  get usadaEn(): Date | null {
    return this.datos.usadaEn;
  }
  get revocadaEn(): Date | null {
    return this.datos.revocadaEn;
  }

  /** Mismo error para usado, vencido o revocado: no se revela cuál fue el motivo. */
  usar(ahora: Date): void {
    if (this.datos.usadaEn || this.datos.revocadaEn || ahora.getTime() >= this.datos.venceEn.getTime()) {
      throw new EnlaceInvalido();
    }
    this.datos.usadaEn = ahora;
  }

  revocar(ahora: Date): void {
    if (this.datos.usadaEn || this.datos.revocadaEn) return;
    this.datos.revocadaEn = ahora;
  }
}
