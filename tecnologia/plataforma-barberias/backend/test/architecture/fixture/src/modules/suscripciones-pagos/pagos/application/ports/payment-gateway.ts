// Fixture de PR14 (T006 de 008): el puerto de la pasarela de la suscripción.
export abstract class PaymentGateway {
  abstract iniciarCobro(): Promise<void>;
}
