// T009 de 005 · Lecturas de agregados de las citas por período (data-model §4 de 005, research R10). Solo conteos:
// sin montos, sin clientes. El período llega como instantes [inicio, fin): la conversión de las fechas locales de la
// barbería la hace quien llama (M04). Corre en la transacción del llamador, con el tenant fijado (RLS) y además
// filtrando por el tenant del contexto. Lo implementa citas/infrastructure/reportes-de-citas-query.ts.

/** Citas cuyo inicio cae en el período, por estado (FR-021 de 005). */
export interface ConteosDeCitas {
  total: number;
  pendientes: number;
  confirmadas: number;
  completadas: number;
  noAsistio: number;
  canceladas: number;
  /** Incluidas en `canceladas`. */
  canceladasTardias: number;
}

/** Un servicio y su número de citas no canceladas, con el nombre que tenía la cita al reservarse (FR-022). */
export interface ServicioSolicitado {
  nombre: string;
  citas: number;
}

/** Actividad del período (FR-023): por barbero, por día de la semana local y los totales de tardías y no asistió. */
export interface ActividadDeCitas {
  /** Solo barberos con citas, de más a menos; con su nombre visible del catálogo. */
  porBarbero: { barberoId: string; barbero: string; citas: number }[];
  /** Siempre siete filas, de lunes (1) a domingo (7), en la zona horaria de la barbería. */
  porDiaDeSemana: { dia: number; citas: number }[];
  cancelacionesTardias: number;
  noAsistencias: number;
}

export abstract class ReportesDeCitasQuery {
  abstract conteos(inicio: Date, fin: Date): Promise<ConteosDeCitas>;
  /** De más a menos citas no canceladas y, en un empate, por nombre; a lo sumo `limite`. */
  abstract serviciosMasSolicitados(inicio: Date, fin: Date, limite: number): Promise<ServicioSolicitado[]>;
  abstract actividad(inicio: Date, fin: Date, zonaHoraria: string): Promise<ActividadDeCitas>;
}
