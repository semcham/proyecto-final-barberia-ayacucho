// Violación a propósito (T003 de 005, ia-solo-por-puerto): el caso de uso del asistente importa un adaptador del
// proveedor de IA en lugar del puerto AIProvider.
import { ProveedorIAFalso } from '../infrastructure/proveedor-ia-falso';

export const usaProveedorFalso = ProveedorIAFalso;
