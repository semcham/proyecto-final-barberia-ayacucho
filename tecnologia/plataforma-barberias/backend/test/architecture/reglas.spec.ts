import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

// T051 · PR14: las reglas de .dependency-cruiser.cjs detectan las violaciones y el código real las cumple.

const RAIZ = join(__dirname, '..', '..');
const DEPCRUISE = join(RAIZ, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');

function depcruise(...rutas: string[]): { codigo: number | null; salida: string } {
  const resultado = spawnSync(
    process.execPath,
    [DEPCRUISE, ...rutas, '--config', '.dependency-cruiser.cjs', '--output-type', 'err'],
    { cwd: RAIZ, encoding: 'utf8' },
  );
  return { codigo: resultado.status, salida: `${resultado.stdout}${resultado.stderr}` };
}

describe('Reglas de arquitectura (PR14)', () => {
  it('el código de la aplicación no viola ninguna regla', () => {
    const { codigo, salida } = depcruise('src', 'migrations');
    expect({ codigo, salida }).toEqual({ codigo: 0, salida: expect.any(String) });
  });

  describe('detecta cada violación del fixture', () => {
    let salida = '';
    let codigo: number | null = null;

    beforeAll(() => {
      ({ codigo, salida } = depcruise('test/architecture/fixture/src'));
    });

    it('termina con error', () => {
      expect(codigo).not.toBe(0);
    });

    it.each([
      'dominio-sin-frameworks',
      'dominio-solo-dominio',
      'dominio-solo-nucleo-puro',
      'aplicacion-sin-infraestructura',
      'modulos-solo-por-index',
      'm06-solo-por-interfaz-publica',
      'matriz-m03',
      'kysely-solo-en-infraestructura',
      // Funcionalidad 002 (T035, T036).
      'matriz-m01',
      'matriz-m02',
      'lectura-publica-confinada',
      // Funcionalidad 006 (T015).
      'redis-confinado',
    ])('%s', (regla) => {
      expect(salida).toContain(regla);
    });

    it('cada violación nueva de 002 se atribuye a su archivo del fixture', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('matriz-m01', 'usa-m02.ts')).toBe(true);
      expect(enLinea('matriz-m02', 'usa-interno-m01.ts')).toBe(true);
      expect(enLinea('lectura-publica-confinada', 'repositorio-citas.ts')).toBe(true);
    });

    it('la violación de 006 se atribuye a su archivo del fixture', () => {
      const lineas = salida.split(/\r?\n/);
      expect(lineas.some((l) => l.includes('redis-confinado') && l.includes('usa-redis.ts'))).toBe(true);
    });
  });
});
