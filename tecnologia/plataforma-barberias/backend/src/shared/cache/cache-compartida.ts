import type { ClaveCache, ClaveContador, ClaveGeneracion } from './claves-cache';

/** Resultado de contar una solicitud en la ventana del límite. */
export interface Conteo {
  total: number;
  msRestantes: number;
}

/**
 * Puerto de la caché compartida entre réplicas (M06, ADR-029). Solo acepta claves de `ClavesCache`
 * (tenant obligatorio) y de `ClaveContador`, nunca texto.
 *
 * Contrato ante fallos (contracts/cache-claves.md §5): ninguna operación lanza. Si la caché no responde
 * a tiempo, está desactivada o el valor no se puede leer:
 * - `obtener` devuelve `null` (ausente) y `leerGeneracion`, `null`;
 * - `guardarSiGeneracion` devuelve `false` e `invalidar` no hace nada;
 * - `contar` devuelve `null`, y quien llama aplica su respaldo (límite por instancia).
 */
export abstract class CacheCompartida {
  /** Valor guardado (JSON con campo `v`), o `null` si está ausente, es ilegible o la caché falla. */
  abstract obtener<T>(clave: ClaveCache): Promise<T | null>;

  /** Generación vigente (ausente = 0), o `null` si la caché falla. */
  abstract leerGeneracion(generacion: ClaveGeneracion): Promise<number | null>;

  /** Guarda solo si la generación sigue siendo `esperada` (atómico, R08). Devuelve si guardó. */
  abstract guardarSiGeneracion<T>(
    clave: ClaveCache,
    generacion: ClaveGeneracion,
    esperada: number,
    valor: T,
    ttlSegundos: number,
  ): Promise<boolean>;

  /** Sube la generación y borra la clave (atómico, R08). Para llamar después de confirmar. */
  abstract invalidar(clave: ClaveCache, generacion: ClaveGeneracion): Promise<void>;

  /** Cuenta una solicitud en la ventana; `null` si la caché no está disponible. */
  abstract contar(clave: ClaveContador, ventanaMs: number): Promise<Conteo | null>;
}
