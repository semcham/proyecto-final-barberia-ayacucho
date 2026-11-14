import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { PurgarIntentosEnlace, VencerAdelantos } from '../modules/catalogo-citas';
import { EnviarAvisos } from '../modules/notificaciones';
import {
  AvisarFinDePrueba,
  ConciliarPagos,
  ExpirarTransferencias,
  VencerSuscripciones,
} from '../modules/suscripciones-pagos';
import { Configuracion, DespachadorDeEventos, EjecutorTareas } from '../shared';

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
    private readonly despachador: DespachadorDeEventos,
    private readonly enviarAvisos: EnviarAvisos,
    private readonly purgarIntentosEnlace: PurgarIntentosEnlace,
    private readonly avisarFinDePrueba: AvisarFinDePrueba,
    private readonly vencerAdelantos: VencerAdelantos,
    private readonly configuracion: Configuracion,
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
    // 004 (ADR-025, R05): respaldo del despacho tras confirmar, con su propio intervalo, y purga de retención.
    this.ejecutor.registrar({
      nombre: 'despachar-eventos',
      intervaloMs: this.configuracion.eventos.intervaloMs,
      ejecutar: () => this.despachador.ejecutar(),
    });
    // 004 (fase 3, ADR-025 pasos 4 a 6): envío de los avisos pendientes, con el mismo intervalo, y su purga a
    // los 90 días (R17).
    this.ejecutor.registrar({
      nombre: 'enviar-avisos',
      intervaloMs: this.configuracion.eventos.intervaloMs,
      ejecutar: () => this.enviarAvisos.ejecutar(),
    });
    // 004 (fase 4, T093): los rechazos de enlaces de más de 24 h, cada hora (constitución 1.4.1, principio III).
    this.ejecutor.registrar({
      nombre: 'purgar-intentos-enlaces',
      intervaloMs: 60 * 60 * 1000,
      ejecutar: () => this.purgarIntentosEnlace.ejecutar(),
    });
    // 004 (fase 6, T128; research R14): aviso de prueba por terminar al propietario, cada 6 h, una vez por prueba.
    this.ejecutor.registrar({
      nombre: 'avisar-fin-de-prueba',
      intervaloMs: 6 * 60 * 60 * 1000,
      ejecutar: () => this.avisarFinDePrueba.ejecutar(),
    });
    // 008 (fase 5, T051; research R09; SC-003): los adelantos sin pago a la hora límite, o sin revisar al límite
    // máximo adicional, vencen solos y liberan el horario; cada 60 s.
    this.ejecutor.registrar({
      nombre: 'vencer-adelantos',
      intervaloMs: 60 * 1000,
      ejecutar: () => this.vencerAdelantos.ejecutar(),
    });
    this.ejecutor.iniciar();
  }
}
