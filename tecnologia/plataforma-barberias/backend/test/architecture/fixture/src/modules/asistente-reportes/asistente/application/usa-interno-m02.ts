// Violación a propósito (T003 de 005, matriz-m04): M04 usa un archivo interno de M02 en lugar de CatalogoCitasApi.
import { cliente } from '../../../catalogo-citas/catalogo/infrastructure/usa-redis';

export const usaInternoM02 = cliente;
