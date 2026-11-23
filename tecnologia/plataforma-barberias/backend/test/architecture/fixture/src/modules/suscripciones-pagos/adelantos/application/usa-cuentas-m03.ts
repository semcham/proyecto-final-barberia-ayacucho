// Violación a propósito (T035 de 010): M03 (el pago del adelanto) sigue sin llamar a M01 (matriz-m03), tampoco por
// las cuentas por correo (cuentas-api-confinada).
import { CuentasApi } from '../../../acceso-barberias/cuentas';

export const usaCuentasDesdeM03 = CuentasApi;
