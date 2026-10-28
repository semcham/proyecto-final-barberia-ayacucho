// Entrada de M06 para las lecturas entre barberías de la plataforma (ADR-031). Aparte de shared/index.ts para
// que la regla lectura-plataforma-confinada de PR14 pueda exigir que solo la importen las carpetas
// infrastructure/plataforma/ de M03 y de M01. La implementación está en persistence/.
export { LecturaPlataforma } from './persistence/lectura-plataforma';
