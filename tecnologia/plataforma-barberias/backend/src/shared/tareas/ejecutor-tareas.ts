import type { Clock } from '../clock/clock';

// Ejecutor de tareas programadas en cada réplica (ADR-024, research R08). M06, sin reglas de negocio:
// - cada tarea se intenta cada `intervaloMs` más un desfase aleatorio de hasta 30 s;
// - un candado de PostgreSQL por tarea (`pg_try_advisory_lock`) hace que solo una réplica la ejecute a la
//   vez; se libera solo si la réplica cae;
// - cada corrida queda en `scheduled_job_run`, solo con conteos.
// La garantía de "una sola vez" NO depende del candado: las tareas hacen transiciones condicionales e
// idempotentes por barbería. El candado solo evita trabajo repetido.

export interface ResultadoDeTarea {
  procesados: number;
  fallidos: number;
}

export interface Tarea {
  /** Nombre único en minúsculas con guiones (p. ej. `vencer-suscripciones`). */
  nombre: string;
  ejecutar(): Promise<ResultadoDeTarea>;
}

export type ResultadoDeCorrida = { ejecutada: false } | ({ ejecutada: true } & ResultadoDeTarea);

/** Candado exclusivo por tarea entre réplicas. */
export abstract class CandadoDeTareas {
  abstract conCandado<T>(
    nombre: string,
    fn: () => Promise<T>,
  ): Promise<{ ejecutada: true; resultado: T } | { ejecutada: false }>;
}

/** Registro de las corridas (scheduled_job_run): tarea, réplica, inicio, fin y conteos. */
export abstract class RegistroDeCorridas {
  abstract iniciar(tarea: string, replica: string, inicio: Date): Promise<string>;
  abstract terminar(
    id: string,
    datos: { fin: Date; procesados: number; fallidos: number; error: string | null },
  ): Promise<void>;
}

export interface Programador {
  programar(fn: () => void, ms: number): unknown;
  cancelar(id: unknown): void;
}

/** setTimeout sin retener el proceso: una réplica que se apaga no espera a su próxima corrida. */
export const PROGRAMADOR_DEL_SISTEMA: Programador = {
  programar: (fn, ms) => setTimeout(fn, ms).unref(),
  cancelar: (id) => clearTimeout(id as NodeJS.Timeout),
};

export const DESFASE_MAXIMO_MS = 30_000;

/**
 * Procesa cada elemento por separado: un error en uno no detiene el resto. `fn` devuelve `false` si el
 * elemento no necesitó cambios (no cuenta como procesado).
 */
export async function procesarCadaUno<T>(
  elementos: readonly T[],
  fn: (elemento: T) => Promise<boolean | void>,
): Promise<ResultadoDeTarea> {
  let procesados = 0;
  let fallidos = 0;
  for (const elemento of elementos) {
    try {
      if ((await fn(elemento)) !== false) procesados += 1;
    } catch {
      fallidos += 1;
    }
  }
  return { procesados, fallidos };
}

export interface OpcionesEjecutor {
  activas: boolean;
  intervaloMs: number;
  /** Nombre de la réplica (INSTANCIA_ID), para el registro. */
  replica: string;
  candado: CandadoDeTareas;
  registro: RegistroDeCorridas;
  reloj: Clock;
  programador?: Programador;
  aleatorio?: () => number;
}

export class EjecutorTareas {
  private readonly tareas = new Map<string, Tarea>();
  private readonly programadas = new Map<string, unknown>();
  private readonly enCurso = new Set<Promise<unknown>>();
  private detenido = false;
  private readonly programador: Programador;
  private readonly aleatorio: () => number;

  constructor(private readonly opciones: OpcionesEjecutor) {
    this.programador = opciones.programador ?? PROGRAMADOR_DEL_SISTEMA;
    this.aleatorio = opciones.aleatorio ?? Math.random;
  }

  registrar(tarea: Tarea): void {
    if (this.tareas.has(tarea.nombre)) throw new Error(`La tarea ${tarea.nombre} ya está registrada`);
    this.tareas.set(tarea.nombre, tarea);
  }

  /** Programa todas las tareas registradas. Con TAREAS_ACTIVAS=false no programa nada. */
  iniciar(): void {
    if (!this.opciones.activas) return;
    for (const nombre of this.tareas.keys()) this.programar(nombre);
  }

  /** Ejecuta una corrida ya (pruebas y demos), con el mismo candado y registro que la programada. */
  async ejecutarAhora(nombre: string): Promise<ResultadoDeCorrida> {
    const tarea = this.tareas.get(nombre);
    if (!tarea) throw new Error(`No hay ninguna tarea registrada con el nombre ${nombre}`);
    const corrida = this.correr(tarea);
    this.enCurso.add(corrida);
    try {
      return await corrida;
    } finally {
      this.enCurso.delete(corrida);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.detenido = true;
    for (const id of this.programadas.values()) this.programador.cancelar(id);
    this.programadas.clear();
    await Promise.allSettled([...this.enCurso]);
  }

  private programar(nombre: string): void {
    if (this.detenido) return;
    const desfase = Math.floor(this.aleatorio() * DESFASE_MAXIMO_MS);
    const id = this.programador.programar(() => {
      this.programadas.delete(nombre);
      void this.ejecutarAhora(nombre)
        .catch(() => undefined)
        .finally(() => this.programar(nombre));
    }, this.opciones.intervaloMs + desfase);
    this.programadas.set(nombre, id);
  }

  private async correr(tarea: Tarea): Promise<ResultadoDeCorrida> {
    const { candado, registro, reloj, replica } = this.opciones;
    const resultado = await candado.conCandado(tarea.nombre, async () => {
      const corridaId = await registro.iniciar(tarea.nombre, replica, reloj.ahora());
      let conteos: ResultadoDeTarea;
      let error: string | null = null;
      try {
        conteos = await tarea.ejecutar();
      } catch (e) {
        // Solo el tipo de error: el registro guarda conteos, nunca datos de barberías ni secretos.
        conteos = { procesados: 0, fallidos: 1 };
        error = e instanceof Error ? e.name.slice(0, 60) : 'Error';
      }
      await registro.terminar(corridaId, { fin: reloj.ahora(), ...conteos, error });
      return conteos;
    });
    return resultado.ejecutada ? { ejecutada: true, ...resultado.resultado } : { ejecutada: false };
  }
}
