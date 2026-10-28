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
      // Funcionalidad 003 (T015).
      'lectura-plataforma-confinada',
      'pasarela-solo-por-puerto',
      'simulador-fuera-del-monolito',
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

    it('cada violación de 003 se atribuye a su archivo del fixture, y el uso permitido no se señala', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('lectura-plataforma-confinada', 'usa-lectura-plataforma.ts')).toBe(true);
      expect(enLinea('lectura-plataforma-confinada', 'lectura-permitida.ts')).toBe(false);
      expect(enLinea('pasarela-solo-por-puerto', 'usa-adaptador.ts')).toBe(true);
      expect(enLinea('pasarela-solo-por-puerto', 'usa-http.ts')).toBe(true);
      expect(enLinea('simulador-fuera-del-monolito', 'usa-simulador.ts')).toBe(true);
    });
  });
});

// T015 de 003 · La capa de aplicación y la de dominio no llaman a fetch: el proveedor solo se alcanza por el
// puerto PaymentGateway (principio V). fetch es global, así que dependency-cruiser no lo ve: se busca en el
// texto fuente.
describe('Sin fetch fuera de la infraestructura (PR14, 003)', () => {
  const { readdirSync, readFileSync } = jest.requireActual<typeof import('node:fs')>('node:fs');

  function archivosDe(carpeta: string): string[] {
    return readdirSync(carpeta, { withFileTypes: true }).flatMap((entrada) => {
      const ruta = join(carpeta, entrada.name);
      return entrada.isDirectory() ? archivosDe(ruta) : ruta.endsWith('.ts') ? [ruta] : [];
    });
  }

  it('ningún archivo de application/ ni de domain/ usa fetch', () => {
    const conFetch = archivosDe(join(RAIZ, 'src', 'modules'))
      .filter((ruta) => /[\\/](application|domain)[\\/]/.test(ruta))
      .filter((ruta) => /(^|[^.\w])fetch\s*\(/.test(readFileSync(ruta, 'utf8')));
    expect(conFetch).toEqual([]);
  });
});
