import { Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { BusDeEventos } from '../shared';

/**
 * Raíz de composición de las suscripciones al bus de eventos de M06 (ADR-025; contracts/eventos.md §1): el
 * único lugar que conecta un tipo de evento con su manejador. Vacía en la fase 1 de 004: los manejadores de M05
 * se suscriben aquí desde la fase 3. Hasta entonces, un evento publicado queda SIN_MANEJADOR (§2.6).
 */
@Injectable()
export class SuscripcionesDeEventos implements OnApplicationBootstrap {
  constructor(private readonly bus: BusDeEventos) {}

  onApplicationBootstrap(): void {
    // Fase 3: this.bus.suscribir('CitaCreada', …), etc.
    void this.bus;
  }
}
