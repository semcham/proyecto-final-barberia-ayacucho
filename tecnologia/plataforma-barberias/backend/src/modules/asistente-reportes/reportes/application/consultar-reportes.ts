import { Injectable } from '@nestjs/common';
import { CatalogoCitasApi } from '../../../catalogo-citas';
import { AuditLog, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { type ActorDeBarberia, AutorizacionAsistenteReportes } from '../../comun/application/autorizacion';
import { Periodo } from '../domain/periodo';
import type { ReportesDelPeriodo } from '../domain/reportes';
import { CifrasDelPeriodo } from './cifras-del-periodo';

/** Lo que pide el propietario: dos fechas locales (sin validar: las valida el dominio con 422). */
export interface ConsultaDeReportes {
  desde?: string;
  hasta?: string;
}

/**
 * T021 de 005 · Los tres reportes del período (US2; FR-019 a FR-026). Solo el propietario (VER_REPORTES). Lee solo
 * por CatalogoCitasApi de M02 (a través de CifrasDelPeriodo, el mismo cálculo que usa el asistente del propietario),
 * dentro de una transacción con el tenant del token (RLS), y deja REPORTES_CONSULTADOS en la auditoría (FR-029). No
 * depende del proveedor de IA (FR-026, regla reportes-sin-ia) ni del estado de la suscripción: es una lectura, y las
 * lecturas no se restringen en ningún estado (003).
 */
@Injectable()
export class ConsultarReportes {
  constructor(
    private readonly autorizacion: AutorizacionAsistenteReportes,
    private readonly catalogoCitas: CatalogoCitasApi,
    private readonly cifras: CifrasDelPeriodo,
    private readonly uow: UnitOfWork,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: ActorDeBarberia, consulta: ConsultaDeReportes): Promise<ReportesDelPeriodo> {
    await this.autorizacion.exigir(actor, 'VER_REPORTES');
    const periodo = Periodo.crear(consulta.desde, consulta.hasta);
    const tenantId = TenantId.de(actor.tenantId);
    // La zona horaria sale de la barbería, antes de abrir la transacción: contextoDeLaBarberia lee la tabla global
    // tenant en su propia transacción (research R01).
    const { zonaHoraria } = await this.catalogoCitas.contextoDeLaBarberia(tenantId);
    const zona = new ZonaHoraria(zonaHoraria);
    const reporte = this.cifras.periodoDelReporte(periodo, zona);

    return this.uow.ejecutar(tenantId, async () => {
      const citas = await this.cifras.citasPorEstado(periodo, zona);
      const serviciosMasSolicitados = await this.cifras.serviciosMasSolicitados(periodo, zona);
      const actividad = await this.cifras.actividad(periodo, zona);
      await this.auditoria.registrar({
        accion: 'REPORTES_CONSULTADOS',
        actorId: actor.usuarioId,
        recurso: `reportes:${reporte.desde}..${reporte.hasta}`,
        resultado: 'PERMITIDO',
      });
      return { periodo: reporte, citas, serviciosMasSolicitados, actividad };
    });
  }
}
