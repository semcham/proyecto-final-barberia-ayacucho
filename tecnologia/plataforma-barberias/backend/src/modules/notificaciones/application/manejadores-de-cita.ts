import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { ClientesApi } from '../../acceso-barberias';
import type { EventoPublicado } from '../../../shared';
import { AVISO_POR_EVENTO_DE_CITA, type Destinatario, PLAZO_AVISO_DE_CITA_MS } from '../domain/aviso';
import { destinatariosDe } from '../domain/destinatarios';
import { elegirCanal } from '../domain/eleccion-canal';
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

  constructor(
    private readonly avisos: AvisoRepository,
    private readonly clientes: ClientesApi,
  ) {}

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

/**
 * Fase 5 · El canal PREVISTO al crear el aviso (constancia, data-model §4): WhatsApp si el cliente lo eligió y tiene
 * consentimiento vigente; si no, correo. El personal recibe siempre por correo. El canal REAL se vuelve a elegir al
 * enviar, con el contacto de ese momento (R12).
 */
export async function canalPrevistoPara(
  clientes: ClientesApi,
  destinatario: Destinatario,
): Promise<'CORREO' | 'WHATSAPP'> {
  if (destinatario.tipo !== 'CLIENTE') return 'CORREO';
  const elegido = elegirCanal(await clientes.contactoParaAvisos(destinatario.ref));
  return 'canal' in elegido ? elegido.canal : 'CORREO';
}
