// Fixture de PR14 (T035 de 010): uso PERMITIDO de CuentasApi desde M05 (correo de la cuenta y token al enviar), que
// no debe señalarse.
import { CuentasApi } from '../../acceso-barberias/cuentas';

export const avisosDeCuenta = CuentasApi;
