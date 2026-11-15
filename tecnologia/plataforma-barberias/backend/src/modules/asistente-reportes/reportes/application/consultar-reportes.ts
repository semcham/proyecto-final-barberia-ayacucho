import { Injectable } from '@nestjs/common';
import { CatalogoCitasApi } from '../../../catalogo-citas';
import { AuditLog, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { type ActorDeBarberia, AutorizacionAsistenteReportes } from '../../comun/application/autorizacion';
import { Periodo } from '../domain/periodo';
import { type ReportesDelPeriodo, SERVICIOS_EN_EL_REPORTE } from '../domain/reportes';

/** Lo que pide el propietario: dos fechas locales (sin validar: las valida el dominio con 422). */
export interface ConsultaDeReportes {
  desde?: string;
  hasta?: string;
}

/**
 * T021 de 005 · Los tres reportes del período (US2; FR-019 a FR-026). Solo el propietario (VER_REPORTES). Lee solo
 * por CatalogoCitasApi de M02, dentro de una transacción con el tenant del token (RLS), y deja REPORTES_CONSULTADOS en
 * la auditoría (FR-029). No depende del proveedor de IA (FR-026, regla reportes-sin-ia) ni del estado de la
 * suscripción: es una lectura, y las lecturas no se restringen en ningún estado (003).
 */
@Injectable()
export class ConsultarReportes {
  constructor(
    private readonly autorizacion: AutorizacionAsistenteReportes,
    private readonly catalogoCitas: CatalogoCitasApi,
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
    const { inicio, fin } = periodo.rango((fecha) => zona.inicioDelDia(fecha));
    const desde = periodo.desde.toString();
    const hasta = periodo.hasta.toString();

    return this.uow.ejecutar(tenantId, async () => {
      const citas = await this.catalogoCitas.conteosDeCitas(inicio, fin);
      const servicios = await this.catalogoCitas.serviciosMasSolicitados(
        inicio,
        fin,
        SERVICIOS_EN_EL_REPORTE,
      );
      const actividad = await this.catalogoCitas.actividad(inicio, fin);
      await this.auditoria.registrar({
        accion: 'REPORTES_CONSULTADOS',
        actorId: actor.usuarioId,
        recurso: `reportes:${desde}..${hasta}`,
        resultado: 'PERMITIDO',
      });
      return {
        periodo: { desde, hasta, zonaHoraria: zona.nombre },
        citas,
        serviciosMasSolicitados: servicios.map((s) => ({ nombre: s.nombre, citas: s.citas })),
        actividad: {
          porBarbero: actividad.porBarbero.map((b) => ({ barbero: b.barbero, citas: b.citas })),
          porDiaDeSemana: actividad.porDiaDeSemana,
          cancelacionesTardias: actividad.cancelacionesTardias,
          noAsistencias: actividad.noAsistencias,
        },
      };
    });
  }
}
