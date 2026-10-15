import { Activacion } from '../../../src/modules/acceso-barberias/identidad/domain/activacion';
import {
  EnlaceInvalido,
  LimiteUsuariosAlcanzado,
} from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import { LimiteUsuarios } from '../../../src/modules/acceso-barberias/identidad/domain/limite-usuarios';

// T096 · Activación de cuenta de un solo uso (R14, FR-022) y límite de usuarios del plan (FR-020).

const HORA_MS = 60 * 60 * 1000;
const T0 = new Date('2026-10-15T12:00:00Z');
const despues = (horas: number) => new Date(T0.getTime() + horas * HORA_MS);

describe('Activacion', () => {
  const nueva = () => Activacion.crear('a1', 'tenant-a', 'u1', T0);

  it('vence a las 72 horas', () => {
    expect(nueva().venceEn).toEqual(despues(72));
  });

  it('se usa una sola vez', () => {
    const activacion = nueva();
    activacion.usar(despues(1));
    expect(activacion.usadaEn).toEqual(despues(1));
    expect(() => activacion.usar(despues(2))).toThrow(EnlaceInvalido);
  });

  it('no se puede usar vencida', () => {
    expect(() => nueva().usar(despues(72))).toThrow(EnlaceInvalido);
    expect(() => nueva().usar(despues(71.9))).not.toThrow();
  });

  it('no se puede usar revocada (al regenerar el enlace)', () => {
    const activacion = nueva();
    activacion.revocar(despues(1));
    expect(() => activacion.usar(despues(2))).toThrow(EnlaceInvalido);
  });

  it('revocar una activación ya usada no la altera', () => {
    const activacion = nueva();
    activacion.usar(despues(1));
    activacion.revocar(despues(2));
    expect(activacion.revocadaEn).toBeNull();
  });
});

describe('LimiteUsuarios', () => {
  it('permite agregar mientras el personal vigente (PENDIENTE + ACTIVA) esté por debajo del máximo', () => {
    expect(LimiteUsuarios.puedeAgregar(4, 5)).toBe(true);
    expect(LimiteUsuarios.puedeAgregar(5, 5)).toBe(false);
    expect(LimiteUsuarios.puedeAgregar(6, 5)).toBe(false);
  });

  it('exigir lanza SUSCRIPCION_NO_PERMITE con el motivo y el máximo', () => {
    expect(() => LimiteUsuarios.exigir(4, 5)).not.toThrow();
    try {
      LimiteUsuarios.exigir(5, 5);
      throw new Error('debía lanzar');
    } catch (error) {
      expect(error).toBeInstanceOf(LimiteUsuariosAlcanzado);
      expect((error as LimiteUsuariosAlcanzado).codigo).toBe('SUSCRIPCION_NO_PERMITE');
      expect((error as LimiteUsuariosAlcanzado).detalles).toEqual([{ motivo: 'LIMITE_USUARIOS', maximo: 5 }]);
    }
  });
});
