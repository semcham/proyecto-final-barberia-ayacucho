import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import {
  ManejadoresDeAdelanto,
  ManejadoresDeCita,
  ManejadoresDeSuscripcion,
  ManejadorRecordatorio,
} from '../modules/notificaciones';
import { BusDeEventos } from '../shared';

/**
 * Raíz de composición de las suscripciones al bus de eventos de M06 (ADR-025; contracts/eventos.md §1): el
 * único lugar que conecta un tipo de evento con su manejador. Un evento sin suscriptor queda SIN_MANEJADOR (§2.6).
 *
 * Fase 3 de 004: los avisos de cita de M05 (CitaCreada, CitaCancelada y CitaReprogramada).
 * Fase 4 de 004: el recordatorio del día (RecordatorioDeCita), con los enlaces de acción.
 * Fase 6 de 004: los avisos de suscripción al propietario (PruebaPorTerminar, SuscripcionEnGracia,
 * SuscripcionVencida, PagoAprobado y PagoRechazado).
 * 008 (T032): los avisos del adelanto de reserva (fase 3: AdelantoSolicitado y PagoDeAdelantoRegistrado).
 */
@Injectable()
export class SuscripcionesDeEventos implements OnApplicationBootstrap {
  constructor(
    private readonly bus: BusDeEventos,
    private readonly avisosDeCita: ManejadoresDeCita,
    private readonly recordatorio: ManejadorRecordatorio,
    private readonly avisosDeSuscripcion: ManejadoresDeSuscripcion,
    private readonly avisosDeAdelanto: ManejadoresDeAdelanto,
  ) {}

  onApplicationBootstrap(): void {
    for (const tipo of ManejadoresDeCita.TIPOS) {
      this.bus.suscribir(tipo, (evento) => this.avisosDeCita.manejar(evento));
    }
    this.bus.suscribir(ManejadorRecordatorio.TIPO, (evento) => this.recordatorio.manejar(evento));
    for (const tipo of ManejadoresDeSuscripcion.TIPOS) {
      this.bus.suscribir(tipo, (evento) => this.avisosDeSuscripcion.manejar(evento));
    }
    for (const tipo of ManejadoresDeAdelanto.TIPOS) {
      this.bus.suscribir(tipo, (evento) => this.avisosDeAdelanto.manejar(evento));
    }
  }
}
