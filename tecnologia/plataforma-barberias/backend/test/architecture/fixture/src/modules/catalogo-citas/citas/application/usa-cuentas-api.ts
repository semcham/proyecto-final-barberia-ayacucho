// Violación a propósito (T035 de 010, cuentas-api-confinada): M02 no usa las cuentas por correo de M01; el correo
// verificado lo exige el guard del host antes de llegar a M02.
import { CuentasApi } from '../../../acceso-barberias/cuentas';

export const usaCuentasDesdeM02 = CuentasApi;
