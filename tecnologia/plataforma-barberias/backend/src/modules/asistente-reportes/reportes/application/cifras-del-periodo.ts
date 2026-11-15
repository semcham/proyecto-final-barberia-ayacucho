import { Injectable } from '@nestjs/common';
import { CatalogoCitasApi } from '../../../catalogo-citas';
import type { ZonaHoraria } from '../../../../shared';
import type { Periodo } from '../domain/periodo';
import {
  type ActividadDelPeriodo,
  type CitasPorEstado,
  type PeriodoDelReporte,
  SERVICIOS_EN_EL_REPORTE,
  type ServicioMasSolicitado,
} from '../domain/reportes';

/**
 * 005 · Las cifras de un período, calculadas UNA sola vez para los dos que las muestran: GET /reportes (US2,
 * ConsultarReportes) y el asistente del propietario (US3, FR-027 y SC-008: "las mismas cifras que los reportes").
 * Solo lee por CatalogoCitasApi de M02, en la transacción de quien llama (con el tenant del token y RLS); no abre
 * transacciones, no audita y no lee la barbería: la zona horaria la trae quien llama, leída antes de la transacción.
 * No depende del asistente ni del proveedor de IA (regla reportes-sin-ia de PR14).
 */
@Injectable()
export class CifrasDelPeriodo {
  constructor(private readonly catalogoCitas: CatalogoCitasApi) {}

  /** El período tal como lo dicen las respuestas: las dos fechas locales y la zona de la barbería. */
  periodoDelReporte(periodo: Periodo, zona: ZonaHoraria): PeriodoDelReporte {
    return { desde: periodo.desde.toString(), hasta: periodo.hasta.toString(), zonaHoraria: zona.nombre };
  }

  citasPorEstado(periodo: Periodo, zona: ZonaHoraria): Promise<CitasPorEstado> {
    const { inicio, fin } = this.rango(periodo, zona);
    return this.catalogoCitas.conteosDeCitas(inicio, fin);
  }

  /** Los 10 primeros, de más a menos citas no canceladas, con el nombre que tenía cada servicio al reservarse. */
  async serviciosMasSolicitados(periodo: Periodo, zona: ZonaHoraria): Promise<ServicioMasSolicitado[]> {
    const { inicio, fin } = this.rango(periodo, zona);
    const servicios = await this.catalogoCitas.serviciosMasSolicitados(inicio, fin, SERVICIOS_EN_EL_REPORTE);
    return servicios.map((s) => ({ nombre: s.nombre, citas: s.citas }));
  }

  async actividad(periodo: Periodo, zona: ZonaHoraria): Promise<ActividadDelPeriodo> {
    const { inicio, fin } = this.rango(periodo, zona);
    const actividad = await this.catalogoCitas.actividad(inicio, fin);
    return {
      porBarbero: actividad.porBarbero.map((b) => ({ barbero: b.barbero, citas: b.citas })),
      porDiaDeSemana: actividad.porDiaDeSemana,
      cancelacionesTardias: actividad.cancelacionesTardias,
      noAsistencias: actividad.noAsistencias,
    };
  }

  private rango(periodo: Periodo, zona: ZonaHoraria): { inicio: Date; fin: Date } {
    return periodo.rango((fecha) => zona.inicioDelDia(fecha));
  }
}
