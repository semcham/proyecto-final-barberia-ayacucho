// Uso permitido (T003 de 005, ia-solo-por-puerto): el módulo de M04 es lo único que enlaza los adaptadores del
// proveedor de IA con el puerto AIProvider.
import { ProveedorIAFalso } from './asistente/infrastructure/proveedor-ia-falso';

export const proveedorEnlazado = ProveedorIAFalso;
