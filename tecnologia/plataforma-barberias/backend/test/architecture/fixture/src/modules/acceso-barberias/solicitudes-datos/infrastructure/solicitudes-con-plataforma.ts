// Violación a propósito (T006 de 007): el submódulo de solicitudes sobre datos personales usa el rol de lectura de la
// plataforma. Lo prohíbe solicitudes-datos-sin-plataforma (el administrador nunca llega a las solicitudes, FR-006).
import { LecturaPlataforma } from '../../../../shared/lectura-plataforma';

export class SolicitudesConPlataforma {
  constructor(readonly lectura: LecturaPlataforma) {}
}
