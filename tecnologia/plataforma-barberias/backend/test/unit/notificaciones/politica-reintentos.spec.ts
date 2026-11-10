import {
  ESPERAS_MS,
  esperaTras,
  INTENTOS_MAXIMOS,
  trasFallo,
} from '../../../src/modules/notificaciones/domain/politica-reintentos';

// T060 · Reintentos de los avisos (FR-032, FR-033; research R13). Esperas de 30 s, 2 min, 10 min, 30 min y 1 h
// con ±20 %; hasta 6 intentos; un error permanente no se reintenta; con el circuito abierto no se consume un
// intento; un aviso de cita sin enviar a las 24 h (discard_after) queda FALLIDO.

const AHORA = new Date('2026-11-12T15:00:00Z');
const EN_24_H = new Date(AHORA.getTime() + 24 * 60 * 60 * 1000);
const MIN = 60_000;

describe('Política de reintentos (T060)', () => {
  it('las esperas base son 30 s, 2 min, 10 min, 30 min y 1 h, y el máximo son 6 intentos', () => {
    expect(ESPERAS_MS).toEqual([30_000, 2 * MIN, 10 * MIN, 30 * MIN, 60 * MIN]);
    expect(INTENTOS_MAXIMOS).toBe(6);
  });

  it('cada espera varía ±20 % (azar 0 → −20 %, azar 1 → +20 %, azar 0,5 → la base)', () => {
    ESPERAS_MS.forEach((base, i) => {
      expect(esperaTras(i + 1, () => 0)).toBeCloseTo(base * 0.8);
      expect(esperaTras(i + 1, () => 1)).toBeCloseTo(base * 1.2);
      expect(esperaTras(i + 1, () => 0.5)).toBeCloseTo(base);
    });
  });

  it('con el azar real, la espera queda siempre dentro de ±20 %', () => {
    for (let i = 0; i < 200; i += 1) {
      const espera = esperaTras(1);
      expect(espera).toBeGreaterThanOrEqual(24_000);
      expect(espera).toBeLessThanOrEqual(36_000);
    }
  });

  it('un fallo temporal consume un intento y espera según el número de intento', () => {
    expect(
      trasFallo({ intentos: 0, fallo: 'TEMPORAL', ahora: AHORA, descartarDespues: EN_24_H, azar: () => 0.5 }),
    ).toEqual({ estado: 'PENDIENTE', intentos: 1, proximoIntento: new Date(AHORA.getTime() + 30_000) });
    expect(
      trasFallo({ intentos: 3, fallo: 'TEMPORAL', ahora: AHORA, descartarDespues: EN_24_H, azar: () => 0.5 }),
    ).toEqual({ estado: 'PENDIENTE', intentos: 4, proximoIntento: new Date(AHORA.getTime() + 30 * MIN) });
  });

  it('el sexto fallo temporal deja el aviso FALLIDO', () => {
    expect(
      trasFallo({ intentos: 4, fallo: 'TEMPORAL', ahora: AHORA, descartarDespues: EN_24_H, azar: () => 0.5 }),
    ).toMatchObject({ estado: 'PENDIENTE', intentos: 5 });
    expect(trasFallo({ intentos: 5, fallo: 'TEMPORAL', ahora: AHORA, descartarDespues: EN_24_H })).toEqual({
      estado: 'FALLIDO',
      intentos: 6,
    });
  });

  it('un error permanente (destinatario inválido) no se reintenta', () => {
    expect(trasFallo({ intentos: 0, fallo: 'PERMANENTE', ahora: AHORA, descartarDespues: EN_24_H })).toEqual({
      estado: 'FALLIDO',
      intentos: 1,
    });
  });

  it('con el circuito abierto no se consume un intento: se vuelve a probar en 30 s', () => {
    expect(
      trasFallo({ intentos: 2, fallo: 'CIRCUITO_ABIERTO', ahora: AHORA, descartarDespues: EN_24_H }),
    ).toEqual({
      estado: 'PENDIENTE',
      intentos: 2,
      proximoIntento: new Date(AHORA.getTime() + 30_000),
    });
  });

  it('pasadas las 24 h (discard_after) el aviso queda FALLIDO, con cualquier fallo', () => {
    for (const fallo of ['TEMPORAL', 'CIRCUITO_ABIERTO'] as const) {
      expect(trasFallo({ intentos: 1, fallo, ahora: EN_24_H, descartarDespues: EN_24_H })).toMatchObject({
        estado: 'FALLIDO',
      });
    }
  });

  it('si el próximo intento caería después del plazo, el aviso queda FALLIDO ya', () => {
    const casiVencido = new Date(EN_24_H.getTime() - 10_000);
    expect(
      trasFallo({
        intentos: 1,
        fallo: 'TEMPORAL',
        ahora: casiVencido,
        descartarDespues: EN_24_H,
        azar: () => 0.5,
      }),
    ).toEqual({ estado: 'FALLIDO', intentos: 2 });
  });
});
