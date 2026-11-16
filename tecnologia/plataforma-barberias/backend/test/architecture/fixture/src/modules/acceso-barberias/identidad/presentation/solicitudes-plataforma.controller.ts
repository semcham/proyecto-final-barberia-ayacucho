// Violación a propósito (T006 de 007): una ruta de la plataforma importa el submódulo de solicitudes sobre datos
// personales. Lo prohíbe solicitudes-datos-sin-plataforma (FR-006: el administrador no ve ninguna solicitud).
import { BandejaFixture } from '../../solicitudes-datos/application/bandeja-fixture';

export class SolicitudesPlataformaController {
  constructor(readonly bandeja: BandejaFixture) {}
}
