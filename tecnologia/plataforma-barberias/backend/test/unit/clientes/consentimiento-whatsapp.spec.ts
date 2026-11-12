import {
  ConsentimientoRequerido,
  decidirCambioDeCanal,
  NumeroWhatsappInvalido,
  retirarConsentimiento,
  type ConsentimientoVigente,
} from '../../../src/modules/acceso-barberias/clientes/domain/consentimiento-whatsapp';
import {
  TEXTO_CONSENTIMIENTO_WHATSAPP,
  VERSION_TEXTO_WHATSAPP,
} from '../../../src/modules/acceso-barberias/clientes/domain/texto-consentimiento-whatsapp';

// T102 · Consentimiento para WhatsApp (FR-017, FR-018; research R18). Elegir WhatsApp exige aceptar
// expresamente, con la versión VIGENTE del texto; cambiar el número retira el consentimiento anterior y exige uno
// nuevo; el retiro guarda su fecha. Volver al correo no cambia el consentimiento (el retiro es aparte).

const AHORA = new Date('2026-11-09T15:00:00Z');
const ANTES = new Date('2026-11-01T15:00:00Z');
const NUMERO = '+51 987 654 321';
const OTRO = '+51 900 111 222';

const vigente = (numero = NUMERO, version = VERSION_TEXTO_WHATSAPP): ConsentimientoVigente => ({
  id: 'k0',
  numero,
  version,
  aceptadoEn: ANTES,
});

const base = { versionVigente: VERSION_TEXTO_WHATSAPP, ahora: AHORA, nuevoId: 'k1' };

describe('Texto del consentimiento (R18)', () => {
  it('versión 2026-11, texto base por validar, con la barbería y el número', () => {
    expect(VERSION_TEXTO_WHATSAPP).toBe('2026-11');
    expect(TEXTO_CONSENTIMIENTO_WHATSAPP).toContain('{nombre de la barbería}');
    expect(TEXTO_CONSENTIMIENTO_WHATSAPP).toContain('{número}');
    expect(TEXTO_CONSENTIMIENTO_WHATSAPP).toMatch(/puedo retirar este permiso cuando quiera/i);
  });
});

describe('Cambiar el canal (T102)', () => {
  it('elegir WhatsApp aceptando con la versión vigente: canal WhatsApp y un consentimiento nuevo', () => {
    const decision = decidirCambioDeCanal({
      ...base,
      actual: { canal: 'CORREO', numero: null },
      vigente: null,
      pedido: { canal: 'WHATSAPP', numeroWhatsapp: NUMERO, aceptaWhatsapp: true, versionTexto: '2026-11' },
    });
    expect(decision).toEqual({
      preferencia: { canal: 'WHATSAPP', numero: NUMERO },
      retirar: null,
      aceptar: { id: 'k1', numero: NUMERO, version: '2026-11', en: AHORA },
      canalCambio: true,
    });
  });

  it('elegir WhatsApp sin aceptar → ConsentimientoRequerido (el canal no cambia)', () => {
    expect(() =>
      decidirCambioDeCanal({
        ...base,
        actual: { canal: 'CORREO', numero: null },
        vigente: null,
        pedido: { canal: 'WHATSAPP', numeroWhatsapp: NUMERO },
      }),
    ).toThrow(ConsentimientoRequerido);
    expect(() =>
      decidirCambioDeCanal({
        ...base,
        actual: { canal: 'CORREO', numero: null },
        vigente: null,
        pedido: { canal: 'WHATSAPP', numeroWhatsapp: NUMERO, aceptaWhatsapp: false, versionTexto: '2026-11' },
      }),
    ).toThrow(ConsentimientoRequerido);
  });

  it('aceptar una versión del texto que no es la vigente → ConsentimientoRequerido', () => {
    const error = (() => {
      try {
        decidirCambioDeCanal({
          ...base,
          actual: { canal: 'CORREO', numero: null },
          vigente: null,
          pedido: {
            canal: 'WHATSAPP',
            numeroWhatsapp: NUMERO,
            aceptaWhatsapp: true,
            versionTexto: '2026-10',
          },
        });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toBeInstanceOf(ConsentimientoRequerido);
    expect((error as ConsentimientoRequerido).codigo).toBe('CONSENTIMIENTO_REQUERIDO');
  });

  it('un número inválido → NumeroWhatsappInvalido (VALIDACION)', () => {
    for (const numero of ['12', 'no es un número', '+51-987-654-321', '9'.repeat(25)]) {
      expect(() =>
        decidirCambioDeCanal({
          ...base,
          actual: { canal: 'CORREO', numero: null },
          vigente: null,
          pedido: {
            canal: 'WHATSAPP',
            numeroWhatsapp: numero,
            aceptaWhatsapp: true,
            versionTexto: '2026-11',
          },
        }),
      ).toThrow(NumeroWhatsappInvalido);
    }
  });

  it('cambiar el número retira el consentimiento anterior (con su fecha) y exige aceptar el nuevo', () => {
    expect(() =>
      decidirCambioDeCanal({
        ...base,
        actual: { canal: 'WHATSAPP', numero: NUMERO },
        vigente: vigente(),
        pedido: { canal: 'WHATSAPP', numeroWhatsapp: OTRO },
      }),
    ).toThrow(ConsentimientoRequerido);
    const decision = decidirCambioDeCanal({
      ...base,
      actual: { canal: 'WHATSAPP', numero: NUMERO },
      vigente: vigente(),
      pedido: { canal: 'WHATSAPP', numeroWhatsapp: OTRO, aceptaWhatsapp: true, versionTexto: '2026-11' },
    });
    expect(decision.retirar).toEqual({ id: 'k0', en: AHORA });
    expect(decision.aceptar).toEqual({ id: 'k1', numero: OTRO, version: '2026-11', en: AHORA });
    expect(decision.preferencia).toEqual({ canal: 'WHATSAPP', numero: OTRO });
  });

  it('volver a guardar WhatsApp con el mismo número y un consentimiento vigente no exige aceptar otra vez', () => {
    const decision = decidirCambioDeCanal({
      ...base,
      actual: { canal: 'WHATSAPP', numero: NUMERO },
      vigente: vigente(),
      pedido: { canal: 'WHATSAPP', numeroWhatsapp: NUMERO },
    });
    expect(decision).toEqual({
      preferencia: { canal: 'WHATSAPP', numero: NUMERO },
      retirar: null,
      aceptar: null,
      canalCambio: false,
    });
  });

  it('volver al correo no toca el consentimiento (el retiro es aparte) y conserva el número', () => {
    const decision = decidirCambioDeCanal({
      ...base,
      actual: { canal: 'WHATSAPP', numero: NUMERO },
      vigente: vigente(),
      pedido: { canal: 'CORREO' },
    });
    expect(decision).toEqual({
      preferencia: { canal: 'CORREO', numero: NUMERO },
      retirar: null,
      aceptar: null,
      canalCambio: true,
    });
  });

  it('volver al correo con OTRO número también retira el consentimiento del número anterior', () => {
    const decision = decidirCambioDeCanal({
      ...base,
      actual: { canal: 'WHATSAPP', numero: NUMERO },
      vigente: vigente(),
      pedido: { canal: 'CORREO', numeroWhatsapp: OTRO },
    });
    expect(decision.retirar).toEqual({ id: 'k0', en: AHORA });
    expect(decision.preferencia).toEqual({ canal: 'CORREO', numero: OTRO });
  });
});

describe('Retirar el consentimiento (T102)', () => {
  it('retira el vigente con la fecha y el canal vuelve a correo', () => {
    expect(
      retirarConsentimiento({
        actual: { canal: 'WHATSAPP', numero: NUMERO },
        vigente: vigente(),
        ahora: AHORA,
      }),
    ).toEqual({
      preferencia: { canal: 'CORREO', numero: NUMERO },
      retirar: { id: 'k0', en: AHORA },
      aceptar: null,
      canalCambio: true,
    });
  });

  it('sin consentimiento vigente no retira nada (204 igual)', () => {
    expect(
      retirarConsentimiento({ actual: { canal: 'CORREO', numero: null }, vigente: null, ahora: AHORA }),
    ).toEqual({
      preferencia: { canal: 'CORREO', numero: null },
      retirar: null,
      aceptar: null,
      canalCambio: false,
    });
  });
});
