// Violación a propósito (T020 de 004, m05-sin-llamadas): nadie llama a M05; recibe los hechos por el bus de
// eventos de M06 (ADR-025, revisión de ADR-013).
import { Notificaciones } from '../../../notificaciones';

export const usaM05 = Notificaciones;
