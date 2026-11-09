// Entrada de M06 para los enlaces de acción firmados (ADR-032). Aparte de shared/index.ts, como
// lectura-plataforma.ts, para que la regla enlaces-confinados de PR14 pueda exigir que solo la importen M05 (al
// emitir el recordatorio) y las rutas de enlaces de M02 (al verificarlos). La implementación está en enlaces/.
export {
  EnlacesFirmados,
  type AccionDeEnlace,
  type DatosDeEnlace,
  type VerificacionDeEnlace,
} from './enlaces/enlaces-firmados';
