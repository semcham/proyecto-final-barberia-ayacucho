// Violación a propósito (T006 de 007): una carpeta plataforma/ (lecturas entre barberías) importa el submódulo de
// solicitudes sobre datos personales. Lo prohíbe solicitudes-datos-sin-plataforma.
import { BandejaFixture } from '../../../solicitudes-datos/application/bandeja-fixture';

export const bandejaDesdePlataforma = (b: BandejaFixture) => b;
