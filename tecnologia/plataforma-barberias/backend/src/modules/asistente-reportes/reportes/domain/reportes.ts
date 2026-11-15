// T021 de 005 · La forma de los tres reportes del período (contracts/openapi.yaml de 005, ReportesDelPeriodo). Solo
// conteos: sin montos, sin nombres ni datos de contacto de clientes (FR-024). Los nombres de los barberos son los
// visibles del catálogo, y los de los servicios, los que tenía cada cita al reservarse (FR-022).

export interface PeriodoDelReporte {
  /** Fechas locales de la barbería, YYYY-MM-DD, ambas incluidas. */
  desde: string;
  hasta: string;
  zonaHoraria: string;
}

export interface CitasPorEstado {
  total: number;
  pendientes: number;
  confirmadas: number;
  completadas: number;
  noAsistio: number;
  canceladas: number;
  /** Incluidas en `canceladas`. */
  canceladasTardias: number;
}

export interface ServicioMasSolicitado {
  nombre: string;
  citas: number;
}

export interface ActividadDelPeriodo {
  porBarbero: { barbero: string; citas: number }[];
  /** Siete filas, de lunes (1) a domingo (7), en la zona horaria de la barbería. */
  porDiaDeSemana: { dia: number; citas: number }[];
  cancelacionesTardias: number;
  noAsistencias: number;
}

export interface ReportesDelPeriodo {
  periodo: PeriodoDelReporte;
  citas: CitasPorEstado;
  /** Los 10 primeros, de más a menos citas no canceladas. */
  serviciosMasSolicitados: ServicioMasSolicitado[];
  actividad: ActividadDelPeriodo;
}

/** Cuántos servicios muestra el reporte de los más solicitados (FR-022). */
export const SERVICIOS_EN_EL_REPORTE = 10;
