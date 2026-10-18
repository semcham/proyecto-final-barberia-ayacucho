import { describe, expect, it } from 'vitest';
import {
  ETIQUETA_HORA_BARBERIA,
  fechaDeBarberia,
  fechaIsoDeBarberia,
  horaConEtiqueta,
  horaDeBarberia,
} from '../src/hora-barberia';

// T039 · Las horas se muestran en la zona de la barbería, nunca en la del dispositivo.

describe('hora de la barbería', () => {
  it('formatea un instante UTC en la hora de Lima (UTC−5), en 24 h', () => {
    expect(horaDeBarberia('2026-10-20T15:00:00Z', 'America/Lima')).toBe('10:00');
    expect(horaDeBarberia('2026-10-20T10:00:00-05:00', 'America/Lima')).toBe('10:00');
    expect(horaDeBarberia(new Date('2026-10-21T03:30:00Z'), 'America/Lima')).toBe('22:30');
  });

  it('la fecha es la del día local de la barbería', () => {
    // 03:30 UTC del 21 son las 22:30 del martes 20 en Lima.
    expect(fechaDeBarberia('2026-10-21T03:30:00Z', 'America/Lima')).toMatch(/martes.*20.*octubre/i);
    expect(fechaIsoDeBarberia('2026-10-21T03:30:00Z', 'America/Lima')).toBe('2026-10-20');
  });

  it('no depende de la zona del dispositivo: la misma hora con otra zona da otro resultado', () => {
    expect(horaDeBarberia('2026-10-20T15:00:00Z', 'Europe/Madrid')).toBe('17:00');
    expect(horaDeBarberia('2026-10-20T15:00:00Z', 'America/Lima')).toBe('10:00');
  });

  it('agrega la etiqueta "hora de la barbería"', () => {
    expect(ETIQUETA_HORA_BARBERIA).toBe('hora de la barbería');
    expect(horaConEtiqueta('2026-10-20T15:00:00Z', 'America/Lima')).toBe('10:00 (hora de la barbería)');
  });
});
