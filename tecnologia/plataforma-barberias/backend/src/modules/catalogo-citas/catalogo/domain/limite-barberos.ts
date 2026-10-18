import { LimiteBarberosAlcanzado } from './errores';

/**
 * T053 · Límite de barberos activos del plan (FR-012, R13). El máximo lo da M03 dentro de la transacción,
 * con la fila de la suscripción bloqueada, para que contar y crear sean atómicos.
 */
export const LimiteBarberos = {
  puedeAgregar(activos: number, maximo: number): boolean {
    return activos < maximo;
  },
  exigir(activos: number, maximo: number): void {
    if (!LimiteBarberos.puedeAgregar(activos, maximo)) throw new LimiteBarberosAlcanzado(maximo);
  },
};
