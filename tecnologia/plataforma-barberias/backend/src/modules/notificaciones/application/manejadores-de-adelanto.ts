import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ClientesApi } from '../../acceso-barberias';
import type { EventoPublicado } from '../../../shared';
import {
  AVISO_POR_EVENTO_DE_ADELANTO,
  DESTINATARIOS_POR_EVENTO_DE_ADELANTO,
  type Destinatario,
  PLAZO_AVISO_DE_ADELANTO_MS,
} from '../domain/aviso';
import { canalPrevistoPara } from './manejadores-de-cita';
import { AvisoRepository } from './ports/aviso-repository';

/**
 * T032 de 008 · Manejadores de los eventos del adelanto (contracts/eventos.md §3 de 008; FR-023), con el mismo
 * mecanismo de 004: corren en la transacción del despacho, con el tenant del evento, y crean un aviso PENDIENTE por
 * destinatario (el cliente por su canal elegido, el propietario por correo). Son idempotentes: el mismo evento
 * despachado otra vez no crea otro aviso (UNIQUE por evento y destinatario, FR-012 de 004). No envían nada: el envío
 * es de la tarea enviar-avisos.
 *
 * Fase 3 (US2): AdelantoSolicitado (al cliente) y PagoDeAdelantoRegistrado (al propietario).
 * Fase 4 (US3): AdelantoConfirmado y PagoDeAdelantoRechazado (al cliente).
 */
@Injectable()
export class ManejadoresDeAdelanto {
  static readonly TIPOS = Object.keys(DESTINATARIOS_POR_EVENTO_DE_ADELANTO);
  private readonly logger = new Logger('ManejadoresDeAdelanto');

  constructor(
    private readonly avisos: AvisoRepository,
    private readonly clientes: ClientesApi,
  ) {}

  async manejar(evento: EventoPublicado): Promise<void> {
    const tipo = AVISO_POR_EVENTO_DE_ADELANTO[evento.tipo];
    const para = DESTINATARIOS_POR_EVENTO_DE_ADELANTO[evento.tipo];
    if (!tipo || !para) throw new Error(`ManejadoresDeAdelanto no atiende el tipo ${evento.tipo}`);
    const citaId = typeof evento.payload.citaId === 'string' ? evento.payload.citaId : null;
    const clienteId = typeof evento.payload.clienteId === 'string' ? evento.payload.clienteId : null;

    const destinatarios: Destinatario[] = [];
    for (const destino of para) {
      if (destino === 'CLIENTE' && clienteId) destinatarios.push({ tipo: 'CLIENTE', ref: clienteId });
      if (destino === 'PROPIETARIO') destinatarios.push({ tipo: 'PROPIETARIO', ref: evento.tenantId.valor });
    }
    if (destinatarios.length === 0) {
      // Evento mal formado (sin cliente): se registra solo el tipo y el id, nunca el payload.
      this.logger.warn(`EVENTO_SIN_DESTINATARIOS tipo=${evento.tipo} id=${evento.id}`);
      return;
    }

    const descartarDespues = new Date(evento.creadoEn.getTime() + PLAZO_AVISO_DE_ADELANTO_MS);
    const avisos = [];
    for (const destinatario of destinatarios) {
      avisos.push({
        id: uuidv7(),
        eventoId: evento.id,
        tipo,
        destinatario,
        citaId,
        canalPrevisto: await canalPrevistoPara(this.clientes, destinatario),
        descartarDespues,
      });
    }
    await this.avisos.crear(avisos);
  }
}
