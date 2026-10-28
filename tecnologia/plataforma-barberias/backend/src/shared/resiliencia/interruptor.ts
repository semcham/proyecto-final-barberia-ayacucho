import type { Clock } from '../clock/clock';

export type EstadoInterruptor = 'cerrado' | 'abierto' | 'semiabierto';

export interface OpcionesInterruptor {
  /** Fallos seguidos que lo abren (R06: 5). */
  fallosParaAbrir: number;
  /** Tiempo abierto antes de dejar pasar una prueba (R06: 10 s). */
  pausaMs: number;
  /**
   * Ventana opcional (R13 de 003, pasarela de pagos: 60 s): solo cuentan los fallos seguidos ocurridos en
   * los últimos `ventanaMs`. Sin ventana, cuentan todos los fallos seguidos (caché, 006).
   */
  ventanaMs?: number;
  reloj: Clock;
  /** Se llama una vez por caída, al pasar de cerrado a abierto. */
  alAbrir?: () => void;
  /** Se llama una vez al recuperarse (semiabierto → cerrado). */
  alRecuperar?: () => void;
}

/**
 * Interruptor de circuito (R06 de 006, ADR-012; R13 de 003) para la caché compartida y la pasarela de pagos.
 * Sin dependencias, con el reloj inyectado para probarlo sin infraestructura.
 *
 * - Cerrado: ejecuta la operación y cuenta los fallos seguidos (dentro de `ventanaMs`, si se indica); con
 *   `fallosParaAbrir`, se abre.
 * - Abierto: durante `pausaMs` no llama a la operación y devuelve el respaldo al instante.
 * - Semiabierto: deja pasar una sola operación de prueba; si funciona se cierra, si falla se reabre.
 *
 * No lanza por sí mismo: un fallo de la operación se convierte en el respaldo, que puede devolver un valor
 * (caché) o lanzar un error propio (pasarela: `ProveedorNoDisponible`).
 */
export class Interruptor {
  /** Instantes de los fallos seguidos que todavía cuentan. */
  private fallos: number[] = [];
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
    this.fallos = [];
    this.abiertoDesde = null;
    if (recuperado) this.opciones.alRecuperar?.();
  }

  private fallo(): void {
    if (this.abiertoDesde !== null) {
      // Falló la prueba en semiabierto: se reabre sin repetir el aviso de caída.
      this.abiertoDesde = this.ahora();
      return;
    }
    const ahora = this.ahora();
    const { ventanaMs } = this.opciones;
    this.fallos.push(ahora);
    if (ventanaMs !== undefined) this.fallos = this.fallos.filter((instante) => ahora - instante < ventanaMs);
    if (this.fallos.length >= this.opciones.fallosParaAbrir) {
      this.abiertoDesde = ahora;
      this.fallos = [];
      this.opciones.alAbrir?.();
    }
  }

  private ahora(): number {
    return this.opciones.reloj.ahora().getTime();
  }
}
