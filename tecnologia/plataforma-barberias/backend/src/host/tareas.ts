import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConciliarPagos } from '../modules/suscripciones-pagos';
import { EjecutorTareas } from '../shared';

/**
 * Raíz de composición de las tareas programadas (ADR-024): registra en el ejecutor de M06 las tareas que
 * ofrecen los módulos y lo pone en marcha al terminar el arranque. 003 suma, con sus historias,
 * `vencer-suscripciones` (US2) y `expirar-transferencias` (US3).
 */
@Injectable()
export class TareasProgramadas implements OnApplicationBootstrap {
  constructor(
    private readonly ejecutor: EjecutorTareas,
    private readonly conciliarPagos: ConciliarPagos,
  ) {}

  onApplicationBootstrap(): void {
    // Principio V: los pagos en línea pendientes se concilian con el proveedor (FR-026 a FR-028).
    this.ejecutor.registrar({ nombre: 'conciliar-pagos', ejecutar: () => this.conciliarPagos.ejecutar() });
    this.ejecutor.iniciar();
  }
}
