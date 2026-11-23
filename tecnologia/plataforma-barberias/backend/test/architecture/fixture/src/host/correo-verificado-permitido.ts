// Fixture de PR14 (T035 de 010): uso PERMITIDO de CuentasApi desde el host (el guard del correo verificado), que no
// debe señalarse.
import { CuentasApi } from '../modules/acceso-barberias/cuentas';

export const guardDelCorreoVerificado = CuentasApi;
