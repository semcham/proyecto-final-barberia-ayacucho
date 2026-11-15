import {
  cuotaDelMomento,
  limitesDeCuota,
} from '../../../src/modules/asistente-reportes/asistente/domain/politica-cuota';
import { ZonaHoraria } from '../../../src/shared';

// T029 de 005 · FR-007 y research R08: la cuota se cuenta por día LOCAL de la barbería y se reinicia a su medianoche;
// el 429 dice cuándo (reiniciaEn) y cuántos segundos esperar (Retry-After). Los límites salen de la configuración,
// iguales para todos los planes.

const LIMA = new ZonaHoraria('America/Lima');

describe('cuotaDelMomento (T029)', () => {
  it('el día es la fecha local de la barbería, no la de UTC', () => {
    // 23:30 de Lima del 14 = 04:30 UTC del 15.
    expect(cuotaDelMomento(new Date('2026-11-15T04:30:00Z'), LIMA).dia).toBe('2026-11-14');
  });

  it('reiniciaEn es la próxima medianoche local, y Retry-After los segundos que faltan (redondeados hacia arriba)', () => {
    const momento = cuotaDelMomento(new Date('2026-11-15T04:30:00Z'), LIMA);
    expect(momento.reiniciaEn).toEqual(new Date('2026-11-15T05:00:00Z'));
    expect(momento.reintentarEnSegundos).toBe(30 * 60);
    expect(cuotaDelMomento(new Date('2026-11-15T04:59:59.200Z'), LIMA).reintentarEnSegundos).toBe(1);
  });

  it('a las 00:00 en punto de Lima empieza el día nuevo, con 24 h por delante', () => {
    const momento = cuotaDelMomento(new Date('2026-11-15T05:00:00Z'), LIMA);
    expect(momento.dia).toBe('2026-11-15');
    expect(momento.reintentarEnSegundos).toBe(24 * 60 * 60);
  });
});

describe('limitesDeCuota', () => {
  it('salen de la configuración (20 por usuario y 200 por barbería por defecto)', () => {
    expect(limitesDeCuota({ cuotaUsuarioDia: 20, cuotaBarberiaDia: 200 })).toEqual({
      usuario: 20,
      barberia: 200,
    });
    expect(limitesDeCuota({ cuotaUsuarioDia: 3, cuotaBarberiaDia: 5 })).toEqual({ usuario: 3, barberia: 5 });
  });
});
