// T033 de 007 · Registro de indicadores de la plataforma (M06; research R01; nota de ADR-031 sobre el registro).
//
// M06 no conoce los módulos ni tiene reglas de negocio: solo junta lo que calcula cada fuente que el host le
// registra al arrancar (host/indicadores.ts, como host/tareas.ts con el EjecutorTareas). Cada módulo aporta una
// fuente que cuenta SOLO sus propias tablas, en su carpeta infrastructure/plataforma/ con el nombre *-indicador.ts
// (regla de PR14 indicadores-solo-por-registro).

/** Una fuente de indicadores: su nombre es la clave de su sección en la respuesta, y `calcular` devuelve solo números. */
export interface FuenteDeIndicador {
  readonly nombre: string;
  calcular(): Promise<unknown>;
}

export class RegistroDeIndicadores {
  private readonly fuentes = new Map<string, FuenteDeIndicador>();

  /** Registra una fuente. Una repetida es un error de programación: se detecta al arrancar. */
  registrar(fuente: FuenteDeIndicador): void {
    if (this.fuentes.has(fuente.nombre)) {
      throw new Error(`La fuente de indicadores "${fuente.nombre}" ya está registrada`);
    }
    this.fuentes.set(fuente.nombre, fuente);
  }

  /** Nombres de las fuentes registradas, en el orden en que se registraron. */
  nombres(): string[] {
    return [...this.fuentes.keys()];
  }

  /**
   * Calcula todas las fuentes a la vez y junta cada resultado bajo su nombre. Si una falla, la consulta falla
   * entera: nunca se devuelve un resultado parcial que pueda leerse como ceros.
   */
  async calcular(): Promise<Record<string, unknown>> {
    const fuentes = [...this.fuentes.values()];
    const resultados = await Promise.all(fuentes.map((fuente) => fuente.calcular()));
    return Object.fromEntries(fuentes.map((fuente, i) => [fuente.nombre, resultados[i]]));
  }
}
