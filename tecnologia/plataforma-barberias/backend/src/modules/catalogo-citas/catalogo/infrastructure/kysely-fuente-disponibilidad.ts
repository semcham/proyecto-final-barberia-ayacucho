import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import { ESTADOS_ACTIVOS } from '../../citas/domain/estado-cita';
import { CatalogQuery } from '../application/ports/catalog-query';
import {
  type ConsultaDelDia,
  type DatosDelDia,
  FuenteDisponibilidad,
  type OcupacionDelDia,
} from '../application/ports/fuente-disponibilidad';

/** Todo el día: CatalogQuery.tramosDelDia ya interseca la disponibilidad con el horario de atención. */
const DIA_COMPLETO = [{ inicioMin: 0, finMin: 24 * 60 }];

/**
 * T071 · Fuente de disponibilidad de la vía autenticada (GET /horarios). Corre dentro de la transacción del
 * caso de uso, con el tenant del token fijado (RLS), y filtra además por el tenant del contexto. Usa las
 * mismas lecturas que la reserva (CatalogQuery), así que ofrece exactamente lo que la reserva acepta.
 */
@Injectable()
export class FuenteDisponibilidadKysely extends FuenteDisponibilidad {
  constructor(
    private readonly catalogo: CatalogQuery,
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  async datosDelDia(consulta: ConsultaDelDia): Promise<DatosDelDia> {
    const servicio = await this.catalogo.servicioActivo(consulta.servicioId);
    if (!servicio) return { duracionMin: null, atencion: [], barberos: [], ocupacion: [] };

    const candidatos = consulta.barberoId
      ? [await this.catalogo.barberoOfrece(consulta.barberoId, consulta.servicioId)].filter((b) => b !== null)
      : await this.catalogo.barberosQueOfrecen(consulta.servicioId);

    const barberos = [];
    const ocupacion: OcupacionDelDia[] = [];
    for (const candidato of candidatos) {
      const tramos = await this.catalogo.tramosDelDia(candidato.barberoId, consulta.fecha);
      barberos.push({
        barberoId: candidato.barberoId,
        activo: true,
        ofreceServicio: true,
        disponibilidad: tramos.map(({ inicioMin, finMin }) => ({ inicioMin, finMin })),
      });
      const bloqueos = await this.catalogo.bloqueosEnRango(
        candidato.barberoId,
        consulta.desde,
        consulta.hasta,
      );
      ocupacion.push(
        ...bloqueos.map((b) => ({ barberoId: candidato.barberoId, inicio: b.inicio, fin: b.fin })),
      );
    }
    ocupacion.push(
      ...(await this.citasActivas(
        candidatos.map((c) => c.barberoId),
        consulta,
      )),
    );
    return { duracionMin: servicio.duracionMin, atencion: DIA_COMPLETO, barberos, ocupacion };
  }

  /** Citas activas de los barberos que se solapan con el día, en una sola consulta. */
  private async citasActivas(barberoIds: string[], consulta: ConsultaDelDia): Promise<OcupacionDelDia[]> {
    if (barberoIds.length === 0) return [];
    const filas = await this.uow
      .transaccionActual()
      .selectFrom('appointment')
      .select(['barber_id', 'starts_at', 'ends_at', 'status'])
      .where('tenant_id', '=', this.tenantContext.actual().valor)
      .where('barber_id', 'in', barberoIds)
      .where('status', 'in', [...ESTADOS_ACTIVOS])
      .where('starts_at', '<', consulta.hasta)
      .where('ends_at', '>', consulta.desde)
      .execute();
    return filas.map((f) => ({
      barberoId: f.barber_id,
      inicio: f.starts_at,
      fin: f.ends_at,
      estadoCita: f.status,
    }));
  }
}
