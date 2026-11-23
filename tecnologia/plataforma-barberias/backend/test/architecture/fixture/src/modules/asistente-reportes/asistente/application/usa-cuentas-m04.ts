// Violación a propósito (T035 de 010): M04 (el asistente) sigue sin llamar a M01 (matriz-m04), tampoco por las
// cuentas por correo (cuentas-api-confinada).
import { CuentasApi } from '../../../acceso-barberias/cuentas';

export const usaCuentasDesdeM04 = CuentasApi;
