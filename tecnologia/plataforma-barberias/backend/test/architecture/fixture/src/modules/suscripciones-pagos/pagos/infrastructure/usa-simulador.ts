// Violación a propósito (T015 de 003): el monolito importa el simulador de la pasarela.
import { iniciarSimulador } from '../../../../../simulador-pagos/servidor';

export const arrancar = iniciarSimulador;
