// Violación a propósito (T109 de 004): el monolito importa el simulador de WhatsApp.
import { iniciarSimuladorWhatsapp } from '../../../../simulador-whatsapp/servidor';

export const arrancar = iniciarSimuladorWhatsapp;
