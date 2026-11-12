import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { EventoPublicado } from '../../../shared';
import { AVISO_POR_EVENTO_DE_SUSCRIPCION, PLAZO_AVISO_DE_SUSCRIPCION_MS } from '../domain/aviso';
import { AvisoRepository } from './ports/aviso-repository';

/**
 * T129 de 004 · Manejador de los eventos de suscripción de M03 (US5; FR-036, FR-038; contracts/eventos.md §3 y §4):
 * PruebaPorTerminar, SuscripcionEnGracia, SuscripcionVencida, PagoAprobado y PagoRechazado.
 *
 * Corre en la transacción del despacho, con el tenant del evento, y crea UN aviso PENDIENTE para el propietario de
 * esa barbería, por correo (`ref` es la barbería: su correo se resuelve AL ENVIAR con
 * `BarberiasApi.correoDelPropietario`; sin un propietario activo con correo, el aviso se descarta con SIN_CANAL).
 * Es idempotente: el mismo evento despachado otra vez no crea otro aviso (UNIQUE por evento y destinatario, FR-012).
 * No envía nada: el envío, con sus reintentos y su circuito, es de la tarea enviar-avisos (FR-011, FR-038).
 */
@Injectable()
export class ManejadoresDeSuscripcion {
  static readonly TIPOS = Object.keys(AVISO_POR_EVENTO_DE_SUSCRIPCION);

  constructor(private readonly avisos: AvisoRepository) {}

  async manejar(evento: EventoPublicado): Promise<void> {
    const tipo = AVISO_POR_EVENTO_DE_SUSCRIPCION[evento.tipo];
    if (!tipo) throw new Error(`ManejadoresDeSuscripcion no atiende el tipo ${evento.tipo}`);
    await this.avisos.crear([
      {
        id: uuidv7(),
        eventoId: evento.id,
        tipo,
        destinatario: { tipo: 'PROPIETARIO', ref: evento.tenantId.valor },
        citaId: null,
        canalPrevisto: 'CORREO',
        descartarDespues: new Date(evento.creadoEn.getTime() + PLAZO_AVISO_DE_SUSCRIPCION_MS),
      },
    ]);
  }
}
