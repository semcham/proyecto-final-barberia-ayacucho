// 005 · Lo que el submódulo `reportes` de M04 expone al resto de M04 (el asistente del propietario, US3). Solo hacia
// afuera: `reportes/` no importa nada de `asistente/` (regla reportes-sin-ia de PR14).
export { CifrasDelPeriodo } from './application/cifras-del-periodo';
export { MAXIMO_DIAS_DEL_PERIODO, Periodo, PeriodoInvalido, type ProblemaDelPeriodo } from './domain/periodo';
export type { CitasPorEstado, PeriodoDelReporte, ServicioMasSolicitado } from './domain/reportes';
