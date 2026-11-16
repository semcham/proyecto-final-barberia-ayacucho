// Violación a propósito (T030 de 007): un archivo de M04 importa directamente la fuente de indicador de M02. Lo
// prohíbe indicadores-solo-por-registro: cada fuente solo la registra el host.
import { CitasPorMesIndicador } from '../../../catalogo-citas/citas/infrastructure/plataforma/citas-por-mes-indicador';

export const fuenteAjena = new CitasPorMesIndicador();
