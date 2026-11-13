import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, BusDeEventos, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import type { ResumenDeAdelanto } from '../../adelantos-api';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { Adelanto } from '../domain/adelanto';
import { tipoDeArchivoDeAdelanto } from '../domain/archivo-adelanto';
import { NumeroDeOperacionInvalido, normalizarNumeroOperacion } from '../domain/numero-operacion';
import { AdelantoRepository } from './ports/adelanto-repository';
import { ArchivosAdelanto } from './ports/archivos-adelanto';
import { aResumen } from './vista-adelanto';

export interface PagoRegistradoPorElCliente {
  numeroOperacion: string;
  /** Captura opcional, en memoria (multer, sin disco). El nombre original no llega aquí: nunca se guarda. */
  captura: Buffer | null;
}

/**
 * T031 de 008 · El cliente registra el pago de su adelanto (US2-3 a US2-5; FR-009 a FR-011, FR-029; PR31):
 * - solo el cliente que reservó (research R02); otro cliente o una cita de otra barbería → 404, sin revelar nada;
 * - el número se normaliza y la captura se verifica por sus bytes ANTES de abrir la transacción (lo inválido no toca
 *   la base);
 * - con el adelanto bloqueado: dentro de la hora límite y sin otro registro vigente; el número no se repite en la
 *   barbería (lo garantiza la base, también con registros simultáneos);
 * - POR_PAGAR → POR_REVISAR, publica PagoDeAdelantoRegistrado (al propietario) y audita, todo en una transacción.
 * El registro no se restringe por el estado de la suscripción: completa una reserva ya aceptada (research R12).
 */
@Injectable()
export class RegistrarPagoDeAdelanto {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly adelantos: AdelantoRepository,
    private readonly archivos: ArchivosAdelanto,
    private readonly eventos: BusDeEventos,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(
    actor: ActorDeBarberia,
    citaId: string,
    pago: PagoRegistradoPorElCliente,
  ): Promise<ResumenDeAdelanto> {
    await this.autorizacion.exigir(actor, 'PAGAR_ADELANTO');
    const numero = normalizarNumeroOperacion(pago.numeroOperacion);
    if (!numero) throw new NumeroDeOperacionInvalido();
    if (pago.captura) tipoDeArchivoDeAdelanto('CAPTURA', pago.captura);

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
      if (!adelanto || adelanto.usuarioClienteId !== actor.usuarioId) throw new NoEncontrado();
      const ahora = this.reloj.ahora();
      const nuevoEstado = Adelanto.registrarPago(adelanto.estado, ahora, adelanto);

      const archivoId = pago.captura
        ? await this.archivos.guardar({
            id: uuidv7(),
            clase: 'CAPTURA',
            contenido: pago.captura,
            por: actor.usuarioId,
          })
        : null;
      await this.adelantos.registrarPago({
        id: uuidv7(),
        adelantoId: adelanto.id,
        numeroOperacion: numero,
        archivoId,
        registradoEn: ahora,
        registradoPor: actor.usuarioId,
      });
      const cambiado = await this.adelantos.cambiarEstado(adelanto.id, {
        desde: adelanto.estado,
        hacia: nuevoEstado,
        en: ahora,
      });
      if (!cambiado) throw new Error('El adelanto cambió durante la transacción a pesar del bloqueo');

      const zona = new ZonaHoraria(adelanto.zonaHoraria);
      // contracts/eventos.md §1: sin el número de operación ni la captura (FR-024).
      await this.eventos.publicar({
        tipo: 'PagoDeAdelantoRegistrado',
        payload: {
          citaId: adelanto.citaId,
          servicio: adelanto.servicio,
          inicio: zona.formatoIso(adelanto.inicio),
          zonaHoraria: adelanto.zonaHoraria,
          montoCentimos: adelanto.montoCentimos,
          codigo: adelanto.codigo,
          limiteRevision: zona.formatoIso(adelanto.limiteRevision),
        },
      });
      await this.auditoria.registrar({
        accion: 'ADELANTO_PAGO_REGISTRADO',
        actorId: actor.usuarioId,
        recurso: `cita:${adelanto.citaId};${nuevoEstado}`,
        resultado: 'PERMITIDO',
      });

      const actualizado = await this.adelantos.deCita(citaId);
      const pagos = await this.adelantos.ultimosPagos([adelanto.id]);
      if (!actualizado) throw new Error('El adelanto desapareció en la transacción');
      return aResumen(actualizado, pagos.get(adelanto.id) ?? null);
    });
  }
}
