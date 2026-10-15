import type { SesionEmitida } from './emitir-sesion';
import type { PerfilUsuario } from './ports/usuario-repository';

/** Resultado de iniciar o renovar una sesión: tokens y datos del usuario con su barbería. */
export interface SesionIniciada {
  sesion: SesionEmitida;
  usuario: PerfilUsuario;
}
