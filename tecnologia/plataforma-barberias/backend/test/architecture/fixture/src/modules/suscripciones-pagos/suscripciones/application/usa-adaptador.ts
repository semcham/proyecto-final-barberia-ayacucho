// Violación a propósito (T015 de 003): un caso de uso importa un adaptador de la pasarela en lugar del puerto.
import { PasarelaSimuladaAdapter } from '../../pagos/infrastructure/pasarela-simulada.adapter';

export const pasarela = new PasarelaSimuladaAdapter();
