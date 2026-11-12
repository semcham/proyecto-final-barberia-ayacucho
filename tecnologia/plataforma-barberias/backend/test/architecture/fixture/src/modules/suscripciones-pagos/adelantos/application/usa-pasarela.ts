// Violación a propósito (T006 de 008, adelantos-sin-pasarela): el adelanto lo paga el cliente directamente a la
// barbería; la plataforma no cobra ni usa PaymentGateway (principio V, ADR-033, FR-027).
import { PaymentGateway } from '../../pagos/application/ports/payment-gateway';

export const usaPasarela = PaymentGateway;
