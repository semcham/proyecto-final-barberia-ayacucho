export interface DatosPlan {
  id: string;
  codigo: string;
  /** Días de prueba gratuita; null si el plan no ofrece prueba. */
  diasPrueba: number | null;
  /** Usuarios del personal permitidos, incluido el propietario. */
  maxUsuarios: number;
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
}
