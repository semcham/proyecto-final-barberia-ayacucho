import { LimiteBarberosAlcanzado } from './errores';

/**
 * T053 · Límite de barberos activos del plan (FR-012, R13). El máximo lo da M03 dentro de la transacción,
 * con la fila de la suscripción bloqueada, para que contar y crear sean atómicos.
 *
 * 011 (research R04): `nuevos` es cuántos se agregan a la vez (la carga en lote pide el cupo para el lote entero).
 * Sin `nuevos`, se agrega uno, como en la creación individual, y el error conserva su detalle de siempre.
 */
export const LimiteBarberos = {
  puedeAgregar(activos: number, maximo: number, nuevos = 1): boolean {
    return activos + nuevos <= maximo;
  },
  exigir(activos: number, maximo: number, nuevos?: number): void {
    if (LimiteBarberos.puedeAgregar(activos, maximo, nuevos)) return;
    throw nuevos === undefined
      ? new LimiteBarberosAlcanzado(maximo)
      : new LimiteBarberosAlcanzado(maximo, { activos, solicitados: nuevos });
  },
};
