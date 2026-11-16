// Fixture de PR14: interfaz pública de M02 (para la violación matriz-m01).
export const CatalogoCitas = 'M02';
// Uso permitido (T030 de 007): el index.ts del propio módulo exporta su fuente de indicador.
export { CitasPorMesIndicador } from './citas/infrastructure/plataforma/citas-por-mes-indicador';
