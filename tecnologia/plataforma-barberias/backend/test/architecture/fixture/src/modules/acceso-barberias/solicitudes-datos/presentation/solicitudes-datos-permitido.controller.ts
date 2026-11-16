// Uso permitido (T006 de 007): la ruta de barbería de las solicitudes importa su propio caso de uso. La regla
// solicitudes-datos-sin-plataforma no lo señala.
import { BandejaFixture } from '../application/bandeja-fixture';

export class SolicitudesDatosPermitidoController {
  constructor(readonly bandeja: BandejaFixture) {}
}
