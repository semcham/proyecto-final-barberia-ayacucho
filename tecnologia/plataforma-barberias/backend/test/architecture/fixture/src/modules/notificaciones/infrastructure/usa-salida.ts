// Violación a propósito (T020 de 004, eventos-solo-por-bus): la salida transaccional solo se usa desde
// shared/eventos/; los módulos publican por el puerto BusDeEventos.
import { SalidaDeEventosPostgres } from '../../../shared/eventos/salida-postgres';

export const usaSalida = SalidaDeEventosPostgres;
