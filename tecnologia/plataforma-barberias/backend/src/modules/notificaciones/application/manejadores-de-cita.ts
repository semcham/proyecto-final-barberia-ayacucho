import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { EventoPublicado } from '../../../shared';
import { AVISO_POR_EVENTO_DE_CITA, PLAZO_AVISO_DE_CITA_MS } from '../domain/aviso';
import { destinatariosDe } from '../domain/destinatarios';
import { AvisoRepository } from './ports/aviso-repository';

/**
 * T072 de 004 · Manejadores de los eventos de cita (ADR-025 paso 3; RF30; contracts/eventos.md §4). Corren en la
 * transacción del despacho, con el tenant del evento: crean un aviso PENDIENTE por destinatario, que se confirma
 * junto con el evento PROCESADO o se revierte entero. Son idempotentes: despachar dos veces el mismo evento no
 * crea otro aviso (FR-012). No envían nada: el envío es de la tarea enviar-avisos (FR-011).
 *
 * Al cancelar o reprogramar, descartan además los recordatorios pendientes de la cita (R09; los crea la fase 4).
 */
@Injectable()
export class ManejadoresDeCita {
  static readonly TIPOS = Object.keys(AVISO_POR_EVENTO_DE_CITA);
  private readonly logger = new Logger('ManejadoresDeCita');

  constructor(private readonly avisos: AvisoRepository) {}

  async manejar(evento: EventoPublicado): Promise<void> {
    const tipo = AVISO_POR_EVENTO_DE_CITA[evento.tipo];
    if (!tipo) throw new Error(`ManejadoresDeCita no atiende el tipo ${evento.tipo}`);
    const citaId = typeof evento.payload.citaId === 'string' ? evento.payload.citaId : null;
    const destinatarios = destinatariosDe(evento.tipo, evento.payload, evento.tenantId.valor);
    if (destinatarios.length === 0) {
      // Evento mal formado (sin cliente): se registra solo el tipo y el id, nunca el payload.
      this.logger.warn(`EVENTO_SIN_DESTINATARIOS tipo=${evento.tipo} id=${evento.id}`);
      return;
    }

    if (citaId && evento.tipo !== 'CitaCreada') await this.avisos.descartarRecordatoriosDe(citaId);
    const descartarDespues = new Date(evento.creadoEn.getTime() + PLAZO_AVISO_DE_CITA_MS);
    await this.avisos.crear(
      destinatarios.map((destinatario) => ({
        id: uuidv7(),
        eventoId: evento.id,
        tipo,
        destinatario,
        citaId,
        // Fase 3: siempre correo. La elección real (canal del cliente y consentimiento) se hace al enviar.
        canalPrevisto: 'CORREO' as const,
        descartarDespues,
      })),
    );
  }
}
