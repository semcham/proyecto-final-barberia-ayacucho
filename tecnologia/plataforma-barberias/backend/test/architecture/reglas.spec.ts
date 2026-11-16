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
      // Funcionalidad 004 (T020).
      'matriz-m05',
      'm05-sin-llamadas',
      'canal-solo-por-puerto',
      'eventos-solo-por-bus',
      'enlaces-confinados',
      // Funcionalidad 004, fase 5 (T109).
      'simulador-whatsapp-fuera-del-monolito',
      // Funcionalidad 008 (T006).
      'adelantos-solo-por-api',
      'adelantos-sin-pasarela',
      // Funcionalidad 005 (T003).
      'matriz-m04',
      'nadie-llama-a-m04',
      'ia-solo-por-puerto',
      'reportes-sin-ia',
      // Funcionalidad 007 (T006).
      'solicitudes-datos-sin-plataforma',
      'indicadores-solo-por-registro',
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

    // T020 de 004 · M05 (revisión de ADR-013, ADR-025, ADR-026, ADR-032).
    it('cada violación de 004 se atribuye a su archivo del fixture, y los usos permitidos no se señalan', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('matriz-m05', 'notificaciones/application/usa-m02.ts')).toBe(true);
      expect(enLinea('m05-sin-llamadas', 'usa-m05.ts')).toBe(true);
      expect(enLinea('canal-solo-por-puerto', 'usa-adaptador-correo.ts')).toBe(true);
      expect(enLinea('eventos-solo-por-bus', 'usa-salida.ts')).toBe(true);
      expect(enLinea('enlaces-confinados', 'usa-enlaces.ts')).toBe(true);
      // Fase 5 (T109): el simulador de WhatsApp nunca entra al monolito.
      expect(enLinea('simulador-whatsapp-fuera-del-monolito', 'usa-simulador-whatsapp.ts')).toBe(true);
      // Usos permitidos: M05 emite enlaces y lista sus avisos pendientes con el rol de la plataforma.
      expect(lineas.some((l) => l.includes('enlaces-permitidos.ts'))).toBe(false);
      expect(lineas.some((l) => l.includes('avisos-pendientes.ts'))).toBe(false);
    });

    // T006 de 008 · El adelanto: M02 lo usa solo por AdelantosApi (research R01) y el adelanto nunca pasa por
    // la pasarela de la suscripción (principio V, ADR-033, FR-027).
    it('cada violación de 008 se atribuye a su archivo del fixture, y el uso por AdelantosApi no se señala', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('adelantos-solo-por-api', 'usa-adelantos-interno.ts')).toBe(true);
      expect(enLinea('adelantos-sin-pasarela', 'adelantos/application/usa-pasarela.ts')).toBe(true);
      expect(lineas.some((l) => l.includes('usa-adelantos-api.ts'))).toBe(false);
    });

    // T003 de 005 · M04 usa M02 y M03 solo por su index.ts (nunca M01 ni M05), nadie llama a M04, el asistente
    // alcanza al proveedor de IA solo por el puerto AIProvider y los reportes no dependen del asistente (FR-026).
    it('cada violación de 005 se atribuye a su archivo del fixture, y los usos permitidos no se señalan', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('matriz-m04', 'asistente/application/usa-m01.ts')).toBe(true);
      expect(enLinea('matriz-m04', 'asistente/application/usa-m05.ts')).toBe(true);
      expect(enLinea('matriz-m04', 'usa-interno-m02.ts')).toBe(true);
      expect(enLinea('nadie-llama-a-m04', 'usa-asistente-reportes.ts')).toBe(true);
      expect(enLinea('ia-solo-por-puerto', 'usa-proveedor-falso.ts')).toBe(true);
      expect(enLinea('reportes-sin-ia', 'reportes/application/usa-asistente.ts')).toBe(true);
      expect(enLinea('kysely-solo-en-infraestructura', 'usa-kysely-en-m04.ts')).toBe(true);
      // Usos permitidos: M02 y M03 por su index, y el módulo de M04 enlaza el adaptador con el puerto.
      expect(lineas.some((l) => l.includes('usa-catalogo-citas-api.ts'))).toBe(false);
      expect(lineas.some((l) => l.includes('asistente-reportes.module.ts'))).toBe(false);
    });

    // T006 de 007 · FR-006: el administrador de la plataforma nunca llega a las solicitudes sobre datos personales.
    // El submódulo no usa el rol de lectura de la plataforma, y ninguna ruta ni carpeta de la plataforma lo importa.
    it('cada violación de 007 se atribuye a su archivo del fixture, y el uso permitido no se señala', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('solicitudes-datos-sin-plataforma', 'solicitudes-con-plataforma.ts')).toBe(true);
      expect(enLinea('solicitudes-datos-sin-plataforma', 'solicitudes-plataforma.controller.ts')).toBe(true);
      expect(enLinea('solicitudes-datos-sin-plataforma', 'plataforma/usa-solicitudes.ts')).toBe(true);
      expect(lineas.some((l) => l.includes('solicitudes-datos-permitido.controller.ts'))).toBe(false);
    });

    // T030 de 007 · research R01: las fuentes de indicadores (infrastructure/plataforma/*-indicador.ts) solo las
    // importan el index.ts de su módulo y host/indicadores.ts, y el registro de M06 no conoce los módulos.
    it('cada violación de la fase 2b de 007 se atribuye a su archivo, y los usos permitidos no se señalan', () => {
      const lineas = salida.split(/\r?\n/);
      const enLinea = (regla: string, archivo: string) =>
        lineas.some((linea) => linea.includes(regla) && linea.includes(archivo));
      expect(enLinea('indicadores-solo-por-registro', 'usa-indicador-m02.ts')).toBe(true);
      expect(enLinea('indicadores-solo-por-registro', 'shared/indicadores/usa-modulo.ts')).toBe(true);
      expect(lineas.some((l) => l.includes('host/indicadores.ts'))).toBe(false);
      // El index.ts de M02 exporta su fuente: como origen, no se señala (sí aparece como destino de la violación de
      // shared/indicadores/usa-modulo.ts).
      expect(enLinea('indicadores-solo-por-registro', 'catalogo-citas/index.ts →')).toBe(false);
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
