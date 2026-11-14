// Violación a propósito (T003 de 005, nadie-llama-a-m04): M02 llama a M04, aunque sea por su index. Solo el host
// importa el módulo de M04.
import { AsistenteReportes } from '../../../asistente-reportes';

export const usaM04 = AsistenteReportes;
