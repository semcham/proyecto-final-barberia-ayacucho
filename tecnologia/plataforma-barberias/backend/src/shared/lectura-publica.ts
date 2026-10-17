// Entrada de M06 para las lecturas públicas por enlace (ADR-021). Aparte de shared/index.ts para que la
// regla lectura-publica-confinada de PR14 pueda exigir que solo la importe
// modules/catalogo-citas/catalogo/infrastructure/publico/. La implementación está en persistence/.
export { LecturaPublica } from './persistence/lectura-publica';
