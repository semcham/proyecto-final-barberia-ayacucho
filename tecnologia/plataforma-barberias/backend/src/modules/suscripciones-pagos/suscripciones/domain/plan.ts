export interface DatosPlan {
  id: string;
  codigo: string;
  /** Días de prueba gratuita; null si el plan no ofrece prueba. */
  diasPrueba: number | null;
  /** Usuarios del personal permitidos, incluido el propietario. */
  maxUsuarios: number;
  /** Barberos activos del catálogo permitidos (FR-012 de 002). */
  maxBarberos: number;
  /** Funcionalidad 003 (R11): nombre visible, precio mensual en céntimos enteros y si se puede contratar. */
  nombre?: string;
  precioCentimos?: number | null;
  moneda?: string;
  activo?: boolean;
  publico?: boolean;
}

/** Plan comercial (catálogo global). Sus valores son datos editables por la plataforma (R13). */
export class Plan {
  private constructor(private readonly datos: DatosPlan) {}

  static reconstruir(datos: DatosPlan): Plan {
    return new Plan({ ...datos });
  }

  get id(): string {
    return this.datos.id;
  }
  get codigo(): string {
    return this.datos.codigo;
  }
  get diasPrueba(): number | null {
    return this.datos.diasPrueba;
  }
  get maxUsuarios(): number {
    return this.datos.maxUsuarios;
  }
  get maxBarberos(): number {
    return this.datos.maxBarberos;
  }
  get nombre(): string {
    return this.datos.nombre ?? this.datos.codigo;
  }
  get precioCentimos(): number | null {
    return this.datos.precioCentimos ?? null;
  }
  get moneda(): string {
    return this.datos.moneda ?? 'PEN';
  }
  /** Se puede contratar: activo, público y con precio (el de prueba nunca). */
  get esContratable(): boolean {
    return (this.datos.activo ?? true) && (this.datos.publico ?? false) && this.precioCentimos !== null;
  }
}
