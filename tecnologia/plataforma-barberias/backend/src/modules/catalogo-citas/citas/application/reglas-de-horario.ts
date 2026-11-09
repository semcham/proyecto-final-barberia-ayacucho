import { Injectable } from '@nestjs/common';
import { Configuracion, ZonaHoraria } from '../../../../shared';
import {
  type BarberoDelServicio,
  CatalogQuery,
  type ServicioVigente,
} from '../../catalogo/application/ports/catalog-query';
import { RangoHorario } from '../../catalogo/domain/rango-horario';
import { ReservaInvalida } from '../../catalogo/domain/errores';

export interface HoraPedida {
  servicioId: string;
  barberoId: string;
  inicio: Date;
  ahora: Date;
  zonaHoraria: string;
  /**
   * Duración que ocupará la cita. Una reserva usa la del servicio vigente; una reprogramación, la copiada al
   * reservar (FR-005 de 004). Si falta, la del servicio.
   */
  duracionMin?: number;
}

export interface HoraValida {
  servicio: ServicioVigente;
  barbero: BarberoDelServicio;
  rango: RangoHorario;
}

/**
 * T049 (004) · Reglas de una hora nueva (FR-030 de 002; FR-003 de 004), extraídas de ReservarCita para que la
 * reprogramación use exactamente las mismas: servicio activo, barbero activo que lo ofrece, en el futuro, dentro
 * del horizonte, en un paso de la agenda, dentro de la disponibilidad del barbero ∩ horario de atención y fuera
 * de bloqueos. Solo dan mensajes mejores: que no haya dos citas activas del mismo barbero que se solapen lo
 * decide la restricción de exclusión de PostgreSQL (principio IV).
 */
@Injectable()
export class ReglasDeHorario {
  constructor(
    private readonly catalogo: CatalogQuery,
    private readonly configuracion: Configuracion,
  ) {}

  async validar(pedida: HoraPedida): Promise<HoraValida> {
    const servicio = await this.catalogo.servicioActivo(pedida.servicioId);
    if (!servicio) throw new ReservaInvalida('SERVICIO_INACTIVO');
    const barbero = await this.catalogo.barberoOfrece(pedida.barberoId, pedida.servicioId);
    if (!barbero) throw new ReservaInvalida('BARBERO_NO_OFRECE_SERVICIO');

    const { inicio, ahora } = pedida;
    const zona = new ZonaHoraria(pedida.zonaHoraria);
    if (inicio.getTime() <= ahora.getTime()) throw new ReservaInvalida('HORA_PASADA');
    const local = zona.aLocal(inicio);
    if (local.fecha.diasDesde(zona.fechaDe(ahora)) > this.configuracion.horarios.horizonteDias) {
      throw new ReservaInvalida('FUERA_DEL_HORIZONTE');
    }
    // Solo las horas que se ofrecen: múltiplos del paso desde la medianoche local, sin segundos (R08).
    if (local.minutos % this.configuracion.horarios.pasoMinutos !== 0 || inicio.getTime() % 60_000 !== 0) {
      throw new ReservaInvalida('FUERA_DE_DISPONIBILIDAD');
    }
    const duracionMin = pedida.duracionMin ?? servicio.duracionMin;
    const finMin = local.minutos + duracionMin;
    const tramos = await this.catalogo.tramosDelDia(pedida.barberoId, local.fecha);
    if (!tramos.some((tramo) => tramo.inicioMin <= local.minutos && finMin <= tramo.finMin)) {
      throw new ReservaInvalida('FUERA_DE_DISPONIBILIDAD');
    }

    const rango = RangoHorario.desde(inicio, duracionMin);
    const bloqueos = await this.catalogo.bloqueosEnRango(pedida.barberoId, rango.inicio, rango.fin);
    if (bloqueos.length > 0) throw new ReservaInvalida('EN_BLOQUEO');
    return { servicio, barbero, rango };
  }
}
