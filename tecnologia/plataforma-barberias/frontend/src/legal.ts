// Versiones vigentes de los textos que acepta el propietario al registrarse (FR-005). Deben coincidir con
// TERMS_VERSION y PRIVACY_POLICY_VERSION del backend; si no coinciden, el servidor rechaza el registro.
export const VERSION_TERMINOS: string = import.meta.env.VITE_TERMS_VERSION ?? '2026-10';
export const VERSION_POLITICA_DATOS: string = import.meta.env.VITE_PRIVACY_POLICY_VERSION ?? '2026-10';
