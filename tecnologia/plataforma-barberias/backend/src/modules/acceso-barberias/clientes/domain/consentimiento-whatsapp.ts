import { ErrorDeAplicacion } from '../../../../shared/nucleo';
import { normalizarNumero, type CanalDeAviso, type PreferenciaAviso } from './preferencia-aviso';

export { NumeroWhatsappInvalido } from './preferencia-aviso';

// T116 de 004 · Consentimiento expreso para recibir avisos por WhatsApp (FR-017, FR-018; data-model §2.2). Regla
// pura: decide, ante un pedido del cliente, la preferencia que queda, el consentimiento que se retira y el que se
// acepta. La evidencia (número, versión del texto, fechas) la guarda la infraestructura; nunca se borra.

/** Elegir WhatsApp sin aceptar el texto vigente (o con otra versión): 422, el canal no cambia. */
export class ConsentimientoRequerido extends ErrorDeAplicacion {
  readonly codigo = 'CONSENTIMIENTO_REQUERIDO';
  constructor() {
    super('Para recibir avisos por WhatsApp tienes que aceptar el texto vigente.');
  }
}

export interface ConsentimientoVigente {
  id: string;
  numero: string;
  version: string;
  aceptadoEn: Date;
}

export interface PedidoDeCanal {
  canal: CanalDeAviso;
  numeroWhatsapp?: string;
  aceptaWhatsapp?: boolean;
  versionTexto?: string;
}

export interface DecisionDeCanal {
  preferencia: PreferenciaAviso;
  /** El consentimiento vigente que se retira (con la fecha del retiro), o null. */
  retirar: { id: string; en: Date } | null;
  /** El consentimiento nuevo, o null. */
  aceptar: { id: string; numero: string; version: string; en: Date } | null;
  canalCambio: boolean;
}

/**
 * PUT del canal:
 * - WHATSAPP exige un número válido y, salvo que ya haya un consentimiento vigente para ese mismo número y la versión
 *   vigente del texto, la aceptación expresa con la versión vigente. Cambiar el número retira el anterior.
 * - CORREO no toca el consentimiento (retirarlo es aparte), salvo que cambie el número guardado: el consentimiento
 *   era para el número anterior y se retira.
 */
export function decidirCambioDeCanal(entrada: {
  actual: PreferenciaAviso;
  vigente: ConsentimientoVigente | null;
  pedido: PedidoDeCanal;
  versionVigente: string;
  ahora: Date;
  nuevoId: string;
}): DecisionDeCanal {
  const { actual, vigente, pedido, versionVigente, ahora, nuevoId } = entrada;
  const canalCambio = actual.canal !== pedido.canal;

  if (pedido.canal === 'CORREO') {
    const numero =
      pedido.numeroWhatsapp !== undefined ? normalizarNumero(pedido.numeroWhatsapp) : actual.numero;
    const otroNumero = vigente !== null && numero !== vigente.numero;
    return {
      preferencia: { canal: 'CORREO', numero },
      retirar: otroNumero ? { id: vigente.id, en: ahora } : null,
      aceptar: null,
      canalCambio,
    };
  }

  const numero = normalizarNumero(pedido.numeroWhatsapp ?? actual.numero);
  const yaVale = vigente !== null && vigente.numero === numero && vigente.version === versionVigente;
  if (yaVale) {
    return { preferencia: { canal: 'WHATSAPP', numero }, retirar: null, aceptar: null, canalCambio };
  }
  if (pedido.aceptaWhatsapp !== true || pedido.versionTexto !== versionVigente)
    throw new ConsentimientoRequerido();
  return {
    preferencia: { canal: 'WHATSAPP', numero },
    retirar: vigente ? { id: vigente.id, en: ahora } : null,
    aceptar: { id: nuevoId, numero, version: versionVigente, en: ahora },
    canalCambio,
  };
}

/** DELETE del consentimiento: se retira el vigente (si hay) y el canal vuelve a correo. El número se conserva. */
export function retirarConsentimiento(entrada: {
  actual: PreferenciaAviso;
  vigente: ConsentimientoVigente | null;
  ahora: Date;
}): DecisionDeCanal {
  const { actual, vigente, ahora } = entrada;
  return {
    preferencia: { canal: 'CORREO', numero: actual.numero },
    retirar: vigente ? { id: vigente.id, en: ahora } : null,
    aceptar: null,
    canalCambio: actual.canal !== 'CORREO',
  };
}
