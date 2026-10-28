import type { Clock, Configuracion } from '../../../../shared';
import type { PaymentGateway } from '../application/ports/payment-gateway';
import { PasarelaSimuladaAdapter } from './pasarela-simulada.adapter';

/**
 * Elige el adaptador de PaymentGateway por PAGOS_PROVEEDOR (ADR-022): pasar del simulador al ambiente de
 * pruebas o a producción cambia la configuración, no el código. Es el único archivo fuera de los
 * adaptadores que los conoce (regla pasarela-solo-por-puerto de PR14).
 */
export function crearPasarela(configuracion: Configuracion, reloj: Clock): PaymentGateway {
  const { proveedor, urlBase, llaveSecreta, secretoFirma, tiempoLimiteMs } = configuracion.pagos;
  switch (proveedor) {
    case 'simulado':
      return new PasarelaSimuladaAdapter({ urlBase, llaveSecreta, secretoFirma, tiempoLimiteMs }, reloj);
    case 'culqi':
      // Línea de corte R15: el adaptador real se construye solo si el proveedor confirma Yape y entrega
      // credenciales de prueba. Mientras tanto, el arranque falla con un mensaje claro.
      throw new Error('El adaptador de la pasarela "culqi" no está disponible todavía (R15)');
  }
}
