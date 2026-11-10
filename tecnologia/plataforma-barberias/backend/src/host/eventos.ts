import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { ManejadoresDeCita } from '../modules/notificaciones';
import { BusDeEventos } from '../shared';

/**
 * Raíz de composición de las suscripciones al bus de eventos de M06 (ADR-025; contracts/eventos.md §1): el
 * único lugar que conecta un tipo de evento con su manejador. Un evento sin suscriptor queda SIN_MANEJADOR (§2.6).
 *
 * Fase 3 de 004: los avisos de cita de M05 (CitaCreada, CitaCancelada y CitaReprogramada).
 */
@Injectable()
export class SuscripcionesDeEventos implements OnApplicationBootstrap {
  constructor(
    private readonly bus: BusDeEventos,
    private readonly avisosDeCita: ManejadoresDeCita,
  ) {}

  onApplicationBootstrap(): void {
    for (const tipo of ManejadoresDeCita.TIPOS) {
      this.bus.suscribir(tipo, (evento) => this.avisosDeCita.manejar(evento));
    }
  }
}
