import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { Clock, type FuenteDeIndicador, ZonaHoraria } from '../../../../../shared';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';

/** Meses de la ventana: el actual de Lima y los 11 anteriores (research R05 de 007). */
const MESES_DE_LA_VENTANA = 12;

/** Orden en que se listan los estados de un mes; uno nuevo, si apareciera, va al final. */
const ORDEN_DE_ESTADOS = ['PENDIENTE', 'CONFIRMADA', 'COMPLETADA', 'NO_ASISTIO', 'CANCELADA'];

export interface CitasDelMes {
  /** `YYYY-MM`, en la zona de la plataforma (America/Lima). */
  mes: string;
  total: number;
  porEstado: { estado: string; citas: number }[];
}

/** Los `cantidad` meses que terminan en el de `hoy`, del más antiguo al más reciente. */
export function mesesHasta(hoy: { anio: number; mes: number }, cantidad: number): string[] {
  return Array.from({ length: cantidad }, (_, i) => {
    const fecha = new Date(Date.UTC(hoy.anio, hoy.mes - 1 - (cantidad - 1 - i), 1));
    return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}

/**
 * T049 de 007 · Fuente de indicadores de M02 (US2, FR-012 y FR-016; research R01 y R05): las citas registradas por mes
 * de los últimos 12 meses, en America/Lima, por estado. Lee SOLO la vista de solo conteo `platform_appointment_counts`
 * con el rol de la plataforma (enmienda 1.7.0, revisión de ADR-031): ese rol no tiene ningún permiso sobre
 * `appointment`. La vista ya llega agregada y sin barbería; aquí solo se completan en cero los meses sin citas.
 */
@Injectable()
export class CitasPorMesIndicador implements FuenteDeIndicador {
  readonly nombre = 'citasPorMes';

  constructor(
    private readonly lectura: LecturaPlataforma,
    private readonly reloj: Clock,
  ) {}

  async calcular(): Promise<CitasDelMes[]> {
    const filas = await this.lectura.ejecutarLectura((trx) =>
      trx
        .selectFrom('platform_appointment_counts')
        .select([sql<string>`to_char(month, 'YYYY-MM')`.as('mes'), 'status', 'appointments'])
        .execute(),
    );
    const meses = mesesHasta(ZonaHoraria.LIMA.fechaDe(this.reloj.ahora()), MESES_DE_LA_VENTANA);
    const porMes = new Map<string, Map<string, number>>(meses.map((mes) => [mes, new Map()]));
    for (const fila of filas) {
      const estados = porMes.get(fila.mes);
      // Una fila fuera de la ventana (el instante de la base y el de la aplicación difieren por milisegundos en el
      // cambio de mes) no se muestra.
      if (estados) estados.set(fila.status, (estados.get(fila.status) ?? 0) + fila.appointments);
    }
    return meses.map((mes) => {
      const estados = porMes.get(mes) as Map<string, number>;
      const porEstado = [...estados]
        .sort(([a], [b]) => posicion(a) - posicion(b) || a.localeCompare(b))
        .map(([estado, citas]) => ({ estado, citas }));
      return { mes, total: porEstado.reduce((suma, e) => suma + e.citas, 0), porEstado };
    });
  }
}

function posicion(estado: string): number {
  const i = ORDEN_DE_ESTADOS.indexOf(estado);
  return i === -1 ? ORDEN_DE_ESTADOS.length : i;
}
