import {
  ClaveCache,
  ClaveContador,
  ClaveGeneracion,
  ClavesCache,
} from '../../../src/shared/cache/claves-cache';
import { TenantId } from '../../../src/shared/tenant/tenant-id';

// T004 · Claves de caché (FR-014, ADR-029, contracts/cache-claves.md): única fábrica, tenant obligatorio,
// prefijo versionado y ninguna clave derivada de texto libre (slug).

const A = TenantId.de('11111111-1111-4111-8111-111111111111');
const SERVICIO = '22222222-2222-4222-8222-222222222222';
const BARBERO = '33333333-3333-4333-8333-333333333333';

describe('ClavesCache', () => {
  it('catálogo público por barbería', () => {
    expect(ClavesCache.catalogoPublico(A).valor).toBe(`bp:v1:t:${A.valor}:catalogo-publico`);
  });

  it('generación del catálogo', () => {
    expect(ClavesCache.generacionCatalogo(A).valor).toBe(`bp:v1:t:${A.valor}:catalogo-publico:gen`);
  });

  it('horarios calculados (FR-013b), con barbero o para todos', () => {
    expect(ClavesCache.horarios(A, 7, SERVICIO, '2026-10-26', BARBERO).valor).toBe(
      `bp:v1:t:${A.valor}:horarios:g7:${SERVICIO}:2026-10-26:${BARBERO}`,
    );
    expect(ClavesCache.horarios(A, 0, SERVICIO, '2026-10-26', null).valor).toBe(
      `bp:v1:t:${A.valor}:horarios:g0:${SERVICIO}:2026-10-26:todos`,
    );
    expect(ClavesCache.generacionHorarios(A).valor).toBe(`bp:v1:t:${A.valor}:horarios:gen`);
  });

  it('devuelve los tipos propios, no texto', () => {
    expect(ClavesCache.catalogoPublico(A)).toBeInstanceOf(ClaveCache);
    expect(ClavesCache.generacionCatalogo(A)).toBeInstanceOf(ClaveGeneracion);
  });

  it('toda clave de datos empieza por bp:v1:t:{tenant}:', () => {
    const claves = [
      ClavesCache.catalogoPublico(A),
      ClavesCache.generacionCatalogo(A),
      ClavesCache.horarios(A, 1, SERVICIO, '2026-10-26', null),
      ClavesCache.generacionHorarios(A),
    ];
    for (const clave of claves) expect(clave.valor.startsWith(`bp:v1:t:${A.valor}:`)).toBe(true);
  });

  describe('sin TenantId no hay clave', () => {
    it.each([
      ['un texto', 'barberia-del-centro'],
      ['un UUID en texto', A.valor],
      ['un objeto parecido', { valor: A.valor }],
      ['undefined', undefined],
    ])('rechaza %s en tiempo de ejecución', (_nombre, valor) => {
      expect(() => ClavesCache.catalogoPublico(valor as unknown as TenantId)).toThrow(/TenantId/);
      expect(() => ClavesCache.generacionCatalogo(valor as unknown as TenantId)).toThrow(/TenantId/);
      expect(() => ClavesCache.generacionHorarios(valor as unknown as TenantId)).toThrow(/TenantId/);
    });

    it('el compilador rechaza un string', () => {
      // @ts-expect-error: las claves de barbería exigen un TenantId, nunca un string (FR-014).
      expect(() => ClavesCache.catalogoPublico('slug-de-barberia')).toThrow();
    });

    it('no se puede construir una ClaveCache ni una ClaveGeneracion por fuera de la fábrica', () => {
      const Cache = ClaveCache as unknown as new (...args: unknown[]) => ClaveCache;
      const Generacion = ClaveGeneracion as unknown as new (...args: unknown[]) => ClaveGeneracion;
      expect(() => new Cache(Symbol('otro'), 'bp:v1:t:x:catalogo-publico')).toThrow(/ClavesCache/);
      expect(() => new Generacion(Symbol('otro'), 'bp:v1:t:x:gen')).toThrow(/ClavesCache/);
    });
  });

  describe('horarios: solo identificadores y fechas, nunca texto libre', () => {
    it.each([
      ['un servicio que no es UUID', 'corte de pelo', '2026-10-26', null, 1],
      ['un barbero que no es UUID', SERVICIO, '2026-10-26', 'luis', 1],
      ['una fecha mal formada', SERVICIO, '26/10/2026', null, 1],
      ['una generación negativa', SERVICIO, '2026-10-26', null, -1],
      ['una generación no entera', SERVICIO, '2026-10-26', null, 1.5],
    ])('rechaza %s', (_nombre, servicio, fecha, barbero, generacion) => {
      expect(() =>
        ClavesCache.horarios(A, generacion as number, servicio as string, fecha as string, barbero),
      ).toThrow();
    });
  });
});

describe('ClaveContador', () => {
  it('usa el prefijo rl:v1: y la clave del límite', () => {
    expect(ClaveContador.desde('5d41402abc4b2a76b9719d911017c592').valor).toBe(
      'rl:v1:5d41402abc4b2a76b9719d911017c592',
    );
  });

  it.each(['', 'con espacio', 'a'.repeat(300), 'salto\nde-linea'])('rechaza %j', (clave) => {
    expect(() => ClaveContador.desde(clave)).toThrow();
  });

  it('no se puede construir por fuera de desde()', () => {
    const Contador = ClaveContador as unknown as new (...args: unknown[]) => ClaveContador;
    expect(() => new Contador(Symbol('otro'), 'rl:v1:x')).toThrow(/ClaveContador/);
  });
});
