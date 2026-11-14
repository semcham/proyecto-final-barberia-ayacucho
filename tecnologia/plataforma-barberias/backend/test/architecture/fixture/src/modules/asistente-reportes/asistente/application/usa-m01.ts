// Violación a propósito (T003 de 005, matriz-m04): M04 llama a M01, aunque sea por su index. La zona horaria y el
// slug le llegan por CatalogoCitasApi de M02 (research R01).
import { AccesoBarberias } from '../../../acceso-barberias';

export const usaM01 = AccesoBarberias;
