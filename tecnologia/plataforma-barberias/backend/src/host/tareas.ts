import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ConciliarPagos, ExpirarTransferencias, VencerSuscripciones } from '../modules/suscripciones-pagos';
import { EjecutorTareas } from '../shared';

/**
 * Raíz de composición de las tareas programadas (ADR-024): registra en el ejecutor de M06 las tareas que
 * ofrecen los módulos y lo pone en marcha al terminar el arranque.
 */
@Injectable()
export class TareasProgramadas implements OnApplicationBootstrap {
  constructor(
    private readonly ejecutor: EjecutorTareas,
    private readonly conciliarPagos: ConciliarPagos,
    private readonly vencerSuscripciones: VencerSuscripciones,
    private readonly expirarTransferencias: ExpirarTransferencias,
  ) {}

  onApplicationBootstrap(): void {
    // Principio V: los pagos en línea pendientes se concilian con el proveedor (FR-026 a FR-028).
    this.ejecutor.registrar({ nombre: 'conciliar-pagos', ejecutar: () => this.conciliarPagos.ejecutar() });
    // RF22: la prueba y los períodos impagos vencen solos (FR-029 a FR-033).
    this.ejecutor.registrar({
      nombre: 'vencer-suscripciones',
      ejecutar: () => this.vencerSuscripciones.ejecutar(),
    });
    // US3: una transferencia sin comprobante en 7 días expira y libera el pago abierto.
    this.ejecutor.registrar({
      nombre: 'expirar-transferencias',
      ejecutar: () => this.expirarTransferencias.ejecutar(),
    });
    this.ejecutor.iniciar();
  }
}
