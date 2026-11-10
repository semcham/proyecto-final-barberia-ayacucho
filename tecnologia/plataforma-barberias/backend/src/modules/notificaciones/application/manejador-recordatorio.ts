import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { EventoPublicado } from '../../../shared';
import { AvisoRepository } from './ports/aviso-repository';

/**
 * T096 de 004 · Manejador de `RecordatorioDeCita` (research R06, R09; FR-022, FR-023, FR-033). M02 lo publica para
 * `inicio − 2 h`, así que llega cuando toca. Crea UN aviso RECORDATORIO para el cliente (idempotente por evento y
 * destinatario), con `discard_after = inicio`: si no sale antes de la hora de la cita, se descarta. Los tres enlaces
 * NO se crean aquí: se firman al enviar (enviar-avisos), con la versión de la cita del evento, y no se guardan.
 */
@Injectable()
export class ManejadorRecordatorio {
  static readonly TIPO = 'RecordatorioDeCita';
  private readonly logger = new Logger('ManejadorRecordatorio');

  constructor(private readonly avisos: AvisoRepository) {}

  async manejar(evento: EventoPublicado): Promise<void> {
    const { citaId, clienteId, inicio } = evento.payload;
    const momento = typeof inicio === 'string' ? new Date(inicio) : null;
    if (
      typeof citaId !== 'string' ||
      typeof clienteId !== 'string' ||
      !momento ||
      Number.isNaN(momento.getTime())
    ) {
      // Solo el tipo y el id: nunca el payload.
      this.logger.warn(`RECORDATORIO_MAL_FORMADO id=${evento.id}`);
      return;
    }
    await this.avisos.crear([
      {
        id: uuidv7(),
        eventoId: evento.id,
        tipo: 'RECORDATORIO',
        destinatario: { tipo: 'CLIENTE', ref: clienteId },
        citaId,
        canalPrevisto: 'CORREO',
        // FR-033: un recordatorio que no salió antes de la hora de inicio se descarta.
        descartarDespues: momento,
      },
    ]);
  }
}
