import { LimiteUsuariosAlcanzado } from './errores';

/**
 * Límite de usuarios del personal según el plan (FR-020). Cuentan los usuarios PENDIENTE y ACTIVA,
 * incluido el propietario; los desactivados no ocupan cupo.
 */
export const LimiteUsuarios = {
  puedeAgregar(vigentes: number, maximo: number): boolean {
    return vigentes < maximo;
  },

  exigir(vigentes: number, maximo: number): void {
    if (!LimiteUsuarios.puedeAgregar(vigentes, maximo)) throw new LimiteUsuariosAlcanzado(maximo);
  },
};
