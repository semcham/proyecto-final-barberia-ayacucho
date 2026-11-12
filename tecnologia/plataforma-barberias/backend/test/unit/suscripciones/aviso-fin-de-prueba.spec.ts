import {
  AVISO_FIN_DE_PRUEBA_DIAS,
  diasRestantes,
  pruebaPorTerminar,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/aviso-fin-de-prueba';

// T123 de 004 · "Prueba por terminar" (FR-037; research R14): el MISMO criterio con el que el panel de 003 muestra
// el aviso (consultas.ts): suscripción en prueba, sin un período siguiente y con 3 días o menos. La regla vive en
// el dominio y la usan el panel y la tarea avisar-fin-de-prueba.

const DIA = 24 * 60 * 60 * 1000;
const AHORA = new Date('2026-11-12T15:00:00.000Z');
const en = (ms: number) => new Date(AHORA.getTime() + ms);

describe('Prueba por terminar (T123, FR-037)', () => {
  it('el umbral es de 3 días, como el panel', () => {
    expect(AVISO_FIN_DE_PRUEBA_DIAS).toBe(3);
  });

  describe('diasRestantes', () => {
    it('redondea hacia arriba los días que faltan', () => {
      expect(diasRestantes(en(3 * DIA), AHORA)).toBe(3);
      expect(diasRestantes(en(3 * DIA + 1), AHORA)).toBe(4);
      expect(diasRestantes(en(2 * DIA + 1), AHORA)).toBe(3);
      expect(diasRestantes(en(1), AHORA)).toBe(1);
    });

    it('nunca es negativo y sin fecha es 0', () => {
      expect(diasRestantes(en(-DIA), AHORA)).toBe(0);
      expect(diasRestantes(null, AHORA)).toBe(0);
    });
  });

  describe('pruebaPorTerminar', () => {
    const base = { estado: 'TRIAL' as const, hayPeriodoSiguiente: false };

    it('en prueba, sin período siguiente y con 3 días o menos: sí', () => {
      for (const dias of [3, 2, 1, 0]) {
        expect(pruebaPorTerminar({ ...base, diasRestantes: dias })).toBe(true);
      }
    });

    it('con 4 días o más: no', () => {
      expect(pruebaPorTerminar({ ...base, diasRestantes: 4 })).toBe(false);
      expect(pruebaPorTerminar({ ...base, diasRestantes: 14 })).toBe(false);
    });

    it('con un período siguiente ya pagado: no', () => {
      expect(pruebaPorTerminar({ ...base, diasRestantes: 1, hayPeriodoSiguiente: true })).toBe(false);
    });

    it('fuera de la prueba: no', () => {
      for (const estado of ['ACTIVE', 'PAST_DUE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const) {
        expect(pruebaPorTerminar({ ...base, estado, diasRestantes: 1 })).toBe(false);
      }
    });
  });
});
