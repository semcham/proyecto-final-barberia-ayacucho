// 010 (T041) · Entrada pública aparte de M01 para las cuentas por correo (como shared/lectura-plataforma.ts en M06):
// no se exporta desde index.ts para que la regla cuentas-api-confinada de PR14 pueda exigir que solo la importen el
// host (guard del correo verificado) y M05 (avisos de la cuenta). M02, M03 y M04 no pueden usarla.
export { CuentasApi, type TokenDeEnlace } from './api-publica';
