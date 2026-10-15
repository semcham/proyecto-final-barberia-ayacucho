// Interfaz pública PURA de M06: sin frameworks ni base de datos. Es lo único de M06 que puede importar
// la capa de dominio de los módulos (principio II). El resto de M06 se importa desde ./index.
export { ErrorDeAplicacion } from './errores';
export { TenantId } from './tenant/tenant-id';
