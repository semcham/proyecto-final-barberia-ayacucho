import {
  debeRespaldar,
  elegirCanal,
  INTENTOS_WHATSAPP,
} from '../../../src/modules/notificaciones/domain/eleccion-canal';

// T101 · Elección del canal de un aviso (FR-019, FR-020; research R12). WhatsApp SOLO con el canal WhatsApp y un
// consentimiento vigente para el número actual; si no, correo. Respaldo por correo, una sola vez, tras 3 fallos
// de WhatsApp, con su circuito abierto o con el número rechazado.

const CORREO = 'rocio@prueba.pe';
const NUMERO = '+51 987 654 321';

describe('Elección de canal (T101)', () => {
  it('WhatsApp con el canal WhatsApp, número y consentimiento vigente', () => {
    expect(
      elegirCanal({ correo: CORREO, canal: 'WHATSAPP', numeroWhatsapp: NUMERO, consentimientoVigente: true }),
    ).toEqual({ canal: 'WHATSAPP', destino: NUMERO });
  });

  it('sin consentimiento vigente (nunca dado, retirado o de otro número): correo, aunque haya número', () => {
    expect(
      elegirCanal({
        correo: CORREO,
        canal: 'WHATSAPP',
        numeroWhatsapp: NUMERO,
        consentimientoVigente: false,
      }),
    ).toEqual({ canal: 'CORREO', destino: CORREO });
  });

  it('con el canal correo: correo, aunque tenga número y consentimiento', () => {
    expect(
      elegirCanal({ correo: CORREO, canal: 'CORREO', numeroWhatsapp: NUMERO, consentimientoVigente: true }),
    ).toEqual({ canal: 'CORREO', destino: CORREO });
  });

  it('con el canal WhatsApp pero sin número guardado: correo', () => {
    expect(
      elegirCanal({ correo: CORREO, canal: 'WHATSAPP', numeroWhatsapp: null, consentimientoVigente: true }),
    ).toEqual({ canal: 'CORREO', destino: CORREO });
  });

  it('respaldo: correo marcado como respaldo aunque WhatsApp esté elegido y vigente', () => {
    expect(
      elegirCanal(
        { correo: CORREO, canal: 'WHATSAPP', numeroWhatsapp: NUMERO, consentimientoVigente: true },
        { respaldo: true },
      ),
    ).toEqual({ canal: 'CORREO', destino: CORREO, respaldo: true });
  });

  it('sin correo y sin WhatsApp posible: se descarta (SIN_CANAL); sin correo pero con WhatsApp vigente: WhatsApp', () => {
    expect(elegirCanal({ correo: null, canal: 'CORREO' })).toEqual({ descartar: 'SIN_CANAL' });
    expect(
      elegirCanal({ correo: null, canal: 'WHATSAPP', numeroWhatsapp: NUMERO, consentimientoVigente: true }),
    ).toEqual({ canal: 'WHATSAPP', destino: NUMERO });
    expect(
      elegirCanal(
        { correo: null, canal: 'WHATSAPP', numeroWhatsapp: NUMERO, consentimientoVigente: true },
        { respaldo: true },
      ),
    ).toEqual({ descartar: 'SIN_CANAL' });
    expect(elegirCanal(null)).toEqual({ descartar: 'SIN_CANAL' });
  });
});

describe('Cuándo pasar al correo de respaldo (T101)', () => {
  it('tras 3 intentos fallidos de WhatsApp (no antes)', () => {
    expect(INTENTOS_WHATSAPP).toBe(3);
    expect(debeRespaldar(1, 'TEMPORAL')).toBe(false);
    expect(debeRespaldar(2, 'TEMPORAL')).toBe(false);
    expect(debeRespaldar(3, 'TEMPORAL')).toBe(true);
  });

  it('con el circuito de WhatsApp abierto, o con el número rechazado, de inmediato', () => {
    expect(debeRespaldar(1, 'CIRCUITO_ABIERTO')).toBe(true);
    expect(debeRespaldar(0, 'CIRCUITO_ABIERTO')).toBe(true);
    expect(debeRespaldar(1, 'PERMANENTE')).toBe(true);
  });
});
