import type { Clock } from '../clock/clock';

export type EstadoInterruptor = 'cerrado' | 'abierto' | 'semiabierto';

export interface OpcionesInterruptor {
  /** Fallos seguidos que lo abren (R06: 5). */
  fallosParaAbrir: number;
  /** Tiempo abierto antes de dejar pasar una prueba (R06: 10 s). */
  pausaMs: number;
  reloj: Clock;
  /** Se llama una vez por caída, al pasar de cerrado a abierto. */
  alAbrir?: () => void;
  /** Se llama una vez al recuperarse (semiabierto → cerrado). */
  alRecuperar?: () => void;
}

/**
 * Interruptor de circuito (R06 de 006, ADR-012) para la caché compartida. Sin dependencias, con el reloj
 * inyectado para probarlo sin infraestructura.
 *
 * - Cerrado: ejecuta la operación y cuenta los fallos seguidos; con `fallosParaAbrir`, se abre.
 * - Abierto: durante `pausaMs` no llama a la operación y devuelve el respaldo al instante.
 * - Semiabierto: deja pasar una sola operación de prueba; si funciona se cierra, si falla se reabre.
 *
 * Nunca lanza: un fallo de la operación se convierte en el valor de respaldo.
 */
export class Interruptor {
  private fallosSeguidos = 0;
  private abiertoDesde: number | null = null;
  private pruebaEnCurso = false;

  constructor(private readonly opciones: OpcionesInterruptor) {}

  get estado(): EstadoInterruptor {
    if (this.abiertoDesde === null) return 'cerrado';
    return this.ahora() - this.abiertoDesde >= this.opciones.pausaMs ? 'semiabierto' : 'abierto';
  }

  async ejecutar<T>(operacion: () => Promise<T>, siAbierto: () => T | Promise<T>): Promise<T> {
    const estado = this.estado;
    if (estado === 'abierto') return siAbierto();
    if (estado === 'semiabierto') {
      if (this.pruebaEnCurso) return siAbierto();
      this.pruebaEnCurso = true;
    }
    try {
      const resultado = await operacion();
      this.exito();
      return resultado;
    } catch {
      this.fallo();
      return siAbierto();
    } finally {
      if (estado === 'semiabierto') this.pruebaEnCurso = false;
    }
  }

  private exito(): void {
    const recuperado = this.abiertoDesde !== null;
    this.fallosSeguidos = 0;
    this.abiertoDesde = null;
    if (recuperado) this.opciones.alRecuperar?.();
  }

  private fallo(): void {
    if (this.abiertoDesde !== null) {
      // Falló la prueba en semiabierto: se reabre sin repetir el aviso de caída.
      this.abiertoDesde = this.ahora();
      return;
    }
    this.fallosSeguidos += 1;
    if (this.fallosSeguidos >= this.opciones.fallosParaAbrir) {
      this.abiertoDesde = this.ahora();
      this.opciones.alAbrir?.();
    }
  }

  private ahora(): number {
    return this.opciones.reloj.ahora().getTime();
  }
}
