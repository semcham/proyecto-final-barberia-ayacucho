import { Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { EventoPublicado } from '../../../shared';
import { AVISO_POR_PROPOSITO_DE_ENLACE, PLAZO_AVISO_DE_CUENTA_MS, type TipoAviso } from '../domain/aviso';
import { destinatarioDeCuenta } from '../domain/destinatarios';
import { AvisoRepository } from './ports/aviso-repository';

/**
 * T043 de 010 · Manejadores de los eventos de la cuenta (contracts/eventos-y-avisos.md de 010), con el mismo mecanismo
 * de 004: corren en la transacción del despacho, con el tenant del evento (el del enlace, R03), y crean UN aviso
 * PENDIENTE para la CUENTA, siempre por correo. Idempotentes (UNIQUE por evento y destinatario). No envían nada ni
 * emiten el token: eso pasa al enviar (enviar-avisos, research R02).
 *
 * - EnlaceDeCuentaSolicitado → VERIFICAR_CORREO o RECUPERAR_CONTRASENA, que se descarta si no sale antes de que venza
 *   su enlace (`discard_after` = vencimiento del enlace).
 * - ContrasenaCambiada → CONTRASENA_CAMBIADA, con el plazo de 24 h de los demás avisos.
 */
@Injectable()
export class ManejadoresDeCuenta {
  static readonly TIPOS = ['EnlaceDeCuentaSolicitado', 'ContrasenaCambiada'] as const;
  private readonly logger = new Logger('ManejadoresDeCuenta');

  constructor(private readonly avisos: AvisoRepository) {}

  async manejar(evento: EventoPublicado): Promise<void> {
    const destinatario = destinatarioDeCuenta(evento.payload);
    const aviso = this.avisoDe(evento);
    if (!destinatario || !aviso) {
      // Evento mal formado: solo el tipo y el id, nunca el payload.
      this.logger.warn(`EVENTO_DE_CUENTA_INVALIDO tipo=${evento.tipo} id=${evento.id}`);
      return;
    }
    await this.avisos.crear([
      {
        id: uuidv7(),
        eventoId: evento.id,
        tipo: aviso.tipo,
        destinatario,
        citaId: null,
        canalPrevisto: 'CORREO',
        descartarDespues: aviso.descartarDespues,
      },
    ]);
  }

  private avisoDe(evento: EventoPublicado): { tipo: TipoAviso; descartarDespues: Date } | null {
    if (evento.tipo === 'ContrasenaCambiada') {
      return {
        tipo: 'CONTRASENA_CAMBIADA',
        descartarDespues: new Date(evento.creadoEn.getTime() + PLAZO_AVISO_DE_CUENTA_MS),
      };
    }
    if (evento.tipo !== 'EnlaceDeCuentaSolicitado') {
      throw new Error(`ManejadoresDeCuenta no atiende el tipo ${evento.tipo}`);
    }
    const tipo = AVISO_POR_PROPOSITO_DE_ENLACE[String(evento.payload.proposito)];
    const venceEn = new Date(String(evento.payload.venceEn));
    const enlaceId = evento.payload.enlaceId;
    if (!tipo || Number.isNaN(venceEn.getTime()) || typeof enlaceId !== 'string' || !enlaceId) return null;
    return { tipo, descartarDespues: venceEn };
  }
}
