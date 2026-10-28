import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { EjecutorTareas } from '../shared';

/**
 * Raíz de composición de las tareas programadas (ADR-024): registra en el ejecutor de M06 las tareas que
 * ofrecen los módulos y lo pone en marcha al terminar el arranque. 003 agrega aquí, con sus historias,
 * `vencer-suscripciones`, `conciliar-pagos` y `expirar-transferencias`.
 */
@Injectable()
export class TareasProgramadas implements OnApplicationBootstrap {
  constructor(private readonly ejecutor: EjecutorTareas) {}

  onApplicationBootstrap(): void {
    this.ejecutor.iniciar();
  }
}
