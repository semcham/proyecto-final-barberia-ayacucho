import { randomUUID } from 'node:crypto';

// Sesiones del simulador, en su memoria: es un único proceso. Al reiniciarlo se pierden, como cuando un
// proveedor real "olvida" una sesión vencida (research R02).

export type EstadoSesion = 'PENDIENTE' | 'APROBADO' | 'RECHAZADO' | 'EXPIRADO' | 'CANCELADO';

export interface Sesion {
  referencia: string;
  pagoId: string;
  importeCentimos: number;
  moneda: string;
  descripcion: string;
  urlRetorno: string;
  creadaEn: Date;
  expiraEn: Date;
  estado: Exclude<EstadoSesion, 'EXPIRADO'>;
  devuelta: boolean;
}

export class EstadoSimulador {
  private readonly sesiones = new Map<string, Sesion>();

  constructor(private readonly vidaSesionMs: number) {}

  crear(datos: Pick<Sesion, 'pagoId' | 'importeCentimos' | 'moneda' | 'descripcion' | 'urlRetorno'>): Sesion {
    const creadaEn = new Date();
    const sesion: Sesion = {
      ...datos,
      referencia: `ses_${randomUUID().replace(/-/g, '')}`,
      creadaEn,
      expiraEn: new Date(creadaEn.getTime() + this.vidaSesionMs),
      estado: 'PENDIENTE',
      devuelta: false,
    };
    this.sesiones.set(sesion.referencia, sesion);
    return sesion;
  }

  buscar(referencia: string): Sesion | undefined {
    return this.sesiones.get(referencia);
  }

  /** Estado visible: una sesión pendiente vencida se informa como EXPIRADO. */
  estadoVisible(sesion: Sesion, ahora = new Date()): EstadoSesion {
    if (sesion.estado === 'PENDIENTE' && ahora.getTime() >= sesion.expiraEn.getTime()) return 'EXPIRADO';
    return sesion.estado;
  }

  reiniciar(): void {
    this.sesiones.clear();
  }
}
