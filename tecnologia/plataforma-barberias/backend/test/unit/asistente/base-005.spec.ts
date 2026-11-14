import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { rolPermiteOperacion } from '../../../src/host/roles.guard';
import { OPERACIONES } from '../../../src/modules/acceso-barberias';
import { OPERACIONES_CATALOGO_CITAS } from '../../../src/modules/catalogo-citas';
import { OPERACIONES_SUSCRIPCIONES } from '../../../src/modules/suscripciones-pagos';
import {
  OPERACIONES_ASISTENTE_REPORTES,
  PermisosAsistenteReportes,
} from '../../../src/modules/asistente-reportes';
import type { AccionAuditada } from '../../../src/shared';

// T010 y T011 de 005 · La matriz de permisos de M04 es la tabla de contracts/rbac.md de 005 (leída del archivo), el
// guard HTTP la conoce como una rama más (las operaciones de M01, M02 y M03 siguen igual) y existen las dos
// acciones de auditoría (research R13).

const ROLES = ['PROPIETARIO', 'BARBERO', 'CLIENTE'] as const;

const RBAC = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '005-asistente-ia-reportes',
  'contracts',
  'rbac.md',
);

/** Filas de la tabla "Operaciones nuevas de la matriz de autorización" de rbac.md: operación → rol → ✓/✗. */
function matrizDelContrato(): Map<string, Record<(typeof ROLES)[number], boolean>> {
  const texto = readFileSync(RBAC, 'utf8');
  const seccion = texto.slice(texto.indexOf('**Operaciones nuevas de la matriz de autorización**'));
  const filas = new Map<string, Record<(typeof ROLES)[number], boolean>>();
  for (const linea of seccion.split(/\r?\n/).filter((l) => l.startsWith('| `'))) {
    const [operacion, propietario, barbero, cliente] = linea
      .split('|')
      .slice(1, 5)
      .map((celda) => celda.trim());
    const nombre = /`([A-Z_]+)`/.exec(operacion)?.[1];
    if (!nombre) continue;
    filas.set(nombre, {
      PROPIETARIO: propietario === '✓',
      BARBERO: barbero === '✓',
      CLIENTE: cliente === '✓',
    });
  }
  return filas;
}

describe('Matriz de permisos de M04 (contracts/rbac.md de 005)', () => {
  const contrato = matrizDelContrato();

  it('el contrato lista las cuatro operaciones y M04 declara exactamente esas', () => {
    expect([...contrato.keys()].sort()).toEqual(
      ['USAR_ASISTENTE', 'USAR_ASISTENTE_CLIENTE', 'USAR_ASISTENTE_PROPIETARIO', 'VER_REPORTES'].sort(),
    );
    expect([...OPERACIONES_ASISTENTE_REPORTES].sort()).toEqual([...contrato.keys()].sort());
  });

  it.each([...matrizDelContrato().entries()])('%s: cada rol, como en el contrato', (operacion, esperado) => {
    for (const rol of ROLES) {
      expect({ rol, permite: PermisosAsistenteReportes.permite(rol, operacion as never) }).toEqual({
        rol,
        permite: esperado[rol],
      });
    }
  });

  it('el guard HTTP conoce las operaciones de M04 con la misma matriz', () => {
    for (const [operacion, esperado] of contrato) {
      for (const rol of ROLES) {
        expect({ operacion, rol, permite: rolPermiteOperacion(rol, operacion) }).toEqual({
          operacion,
          rol,
          permite: esperado[rol],
        });
      }
    }
  });

  it('las operaciones de M01, M02 y M03 siguen igual en el guard (sin cambio de comportamiento)', () => {
    expect(rolPermiteOperacion('PROPIETARIO', 'LISTAR_USUARIOS')).toBe(true);
    expect(rolPermiteOperacion('CLIENTE', 'RESERVAR_CITA')).toBe(true);
    expect(rolPermiteOperacion('BARBERO', 'RESERVAR_CITA')).toBe(false);
    expect(rolPermiteOperacion('CLIENTE', 'PAGAR_ADELANTO')).toBe(true);
    expect(rolPermiteOperacion('PROPIETARIO', 'PAGAR_ADELANTO')).toBe(false);
    expect(() => rolPermiteOperacion('PROPIETARIO', 'BORRAR_TODO')).toThrow(/desconocida/);
  });

  it('ninguna operación de M04 repite el nombre de una de otro módulo', () => {
    // Si lo repitiera, el guard aplicaría la matriz del primer módulo que la conoce.
    const otras = new Set<string>([
      ...OPERACIONES,
      ...OPERACIONES_CATALOGO_CITAS,
      ...OPERACIONES_SUSCRIPCIONES,
    ]);
    expect(OPERACIONES_ASISTENTE_REPORTES.filter((operacion) => otras.has(operacion))).toEqual([]);
  });
});

describe('Acciones de auditoría de 005 (research R13)', () => {
  it('existen las dos y caben en audit_log.action varchar(48)', () => {
    // Si alguna no está en AccionAuditada, este archivo no compila.
    const acciones: AccionAuditada[] = ['ASISTENTE_CONSULTADO', 'REPORTES_CONSULTADOS'];
    expect(new Set(acciones).size).toBe(2);
    for (const accion of acciones) expect(accion.length).toBeLessThanOrEqual(48);
  });
});
