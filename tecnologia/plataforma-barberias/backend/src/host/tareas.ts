import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConciliarPagos, VencerSuscripciones } from '../modules/suscripciones-pagos';
import { EjecutorTareas } from '../shared';

/**
 * Raíz de composición de las tareas programadas (ADR-024): registra en el ejecutor de M06 las tareas que
 * ofrecen los módulos y lo pone en marcha al terminar el arranque. 003 suma `expirar-transferencias` con
 * US3.
 */
@Injectable()
export class TareasProgramadas implements OnApplicationBootstrap {
  constructor(
    private readonly ejecutor: EjecutorTareas,
    private readonly conciliarPagos: ConciliarPagos,
    private readonly vencerSuscripciones: VencerSuscripciones,
  ) {}

  onApplicationBootstrap(): void {
    // Principio V: los pagos en línea pendientes se concilian con el proveedor (FR-026 a FR-028).
    this.ejecutor.registrar({ nombre: 'conciliar-pagos', ejecutar: () => this.conciliarPagos.ejecutar() });
    // RF22: la prueba y los períodos impagos vencen solos (FR-029 a FR-033).
    this.ejecutor.registrar({
      nombre: 'vencer-suscripciones',
      ejecutar: () => this.vencerSuscripciones.ejecutar(),
    });
    this.ejecutor.iniciar();
  }
}
