// Violación a propósito (T030 de 007): el registro de indicadores de M06 importa un módulo de negocio. Lo prohíbe
// indicadores-solo-por-registro: M06 solo junta lo que el host le registra, sin conocer los módulos.
import { CatalogoCitas } from '../../modules/catalogo-citas';

export const moduloConocido = CatalogoCitas;
