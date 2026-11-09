// Violación a propósito (T020 de 004, enlaces-confinados): los enlaces firmados solo los emite M05 y solo
// los verifican las rutas de enlaces de M02 (ADR-032).
import { EnlacesFirmados } from '../../../../shared/enlaces-firmados';

export const usaEnlaces = EnlacesFirmados;
