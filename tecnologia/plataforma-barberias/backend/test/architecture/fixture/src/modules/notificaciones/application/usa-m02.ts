// Violación a propósito (T020 de 004, matriz-m05): M05 solo puede llamar a M01 (por su index.ts) y a M06.
import { CatalogoCitas } from '../../catalogo-citas';

export const usaM02 = CatalogoCitas;
