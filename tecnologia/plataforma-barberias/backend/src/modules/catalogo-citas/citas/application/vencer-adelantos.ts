import { Injectable } from '@nestjs/common';
import { BarberiasApi } from '../../../acceso-barberias';
import { AdelantosApi, type CandidatoPorVencer } from '../../../suscripciones-pagos';
import {
  AuditLog,
  BusDeEventos,
  Clock,
  procesarCadaUno,
  type ResultadoDeTarea,
  TenantId,
  UnitOfWork,
  ZonaHoraria,
} from '../../../../shared';
import { CitaRepository } from './ports/cita-repository';
import { anularRecordatorio } from './recordatorio-de-cita';

const LOTE = 100;

/**
 * T051 de 008 · Tarea `vencer-adelantos` (US4; FR-016 a FR-019; research R06, R09), cada 60 s con el candado del
 * ejecutor (ADR-024). La garantía de "una sola vez" no depende del candado:
 * - lee por la vía de la plataforma (solo columnas técnicas), en lotes de 100, los adelantos por pagar con la hora
 *   límite cumplida y los por revisar con el límite máximo adicional cumplido;
 * - procesa CADA uno en su propia transacción, con el tenant de su barbería y RLS: bloquea la cita con
 *   `FOR UPDATE SKIP LOCKED` (si la tiene otra transacción, p. ej. una confirmación en curso, la deja para la próxima
 *   corrida) y después, dentro de AdelantosApi.decidirVencimiento, el adelanto: el mismo orden que ConfirmarAdelanto,
 *   así confirmar y vencer a la vez se excluyen (FR-015, PR32);
 * - si corresponde, el adelanto pasa a VENCIDO o POR_DEVOLVER (transición condicional) y la cita PENDIENTE a
 *   CANCELADA sin marca de tardía; publica AdelantoVencido (en lugar de CitaCancelada; aviso al cliente y al
 *   propietario), anula el recordatorio si lo hubiera y audita ADELANTO_VENCIDO sin actor;
 * - un error en un adelanto no detiene el resto, y una corrida interrumpida se retoma en la siguiente sin repetir lo
 *   ya hecho (FR-019).
 */
@Injectable()
export class VencerAdelantos {
  constructor(
    private readonly adelantos: AdelantosApi,
    private readonly citas: CitaRepository,
    private readonly barberias: BarberiasApi,
    private readonly eventos: BusDeEventos,
    private readonly auditoria: AuditLog,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const ahora = this.reloj.ahora();
    const total: ResultadoDeTarea = { procesados: 0, fallidos: 0 };
    let despuesDe: string | null = null;
    for (;;) {
      const lote = await this.adelantos.porVencer(ahora, LOTE, despuesDe);
      if (lote.length === 0) break;
      const resultado = await procesarCadaUno(lote, (candidato) => this.vencer(candidato, ahora));
      total.procesados += resultado.procesados;
      total.fallidos += resultado.fallidos;
      if (lote.length < LOTE) break;
      despuesDe = lote[lote.length - 1].adelantoId;
    }
    return total;
  }

  private vencer(candidato: CandidatoPorVencer, ahora: Date): Promise<boolean> {
    return this.uow.ejecutar(TenantId.de(candidato.tenantId), async () => {
      const citaId = await this.adelantos.citaDelAdelanto(candidato.adelantoId);
      if (!citaId) return false;
      // Primero la cita (sin esperar), después el adelanto: el orden de ConfirmarAdelanto (research R06).
      const cita = await this.citas.buscarParaActualizar(citaId, { saltarSiBloqueada: true });
      if (!cita || cita.estado !== 'PENDIENTE') return false;
      const resultado = await this.adelantos.decidirVencimiento(cita.id, ahora);
      if (!resultado) return false;

      const anterior = cita.estado;
      cita.vencerAdelanto(ahora);
      await this.citas.actualizarEstado(cita, anterior, null);
      await this.auditoria.registrar({
        accion: 'ADELANTO_VENCIDO',
        actorId: null,
        recurso: `cita:${cita.id};${resultado.estado}`,
        resultado: 'PERMITIDO',
        en: ahora,
      });
      await anularRecordatorio(this.eventos, cita.id);
      const { zonaHoraria } = await this.barberias.configuracionAgenda();
      const zona = new ZonaHoraria(zonaHoraria);
      // contracts/eventos.md §1 de 008: solo lo que el aviso necesita; nunca el número de operación ni la captura.
      await this.eventos.publicar({
        tipo: 'AdelantoVencido',
        payload: {
          citaId: cita.id,
          clienteId: cita.clienteId,
          servicio: cita.servicio.nombre,
          inicio: zona.formatoIso(cita.rango.inicio),
          zonaHoraria,
          montoCentimos: resultado.adelanto.montoCentimos,
          codigo: resultado.adelanto.codigo,
          causa: resultado.causa,
          porDevolver: resultado.estado === 'POR_DEVOLVER',
        },
      });
      return true;
    });
  }
}
