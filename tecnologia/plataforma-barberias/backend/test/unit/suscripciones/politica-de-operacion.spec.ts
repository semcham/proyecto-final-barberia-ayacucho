import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SuscripcionNoPermite } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/errores';
import {
  ACCIONES_SUSCRIPCION,
  type AccionSuscripcion,
  PoliticaDeOperacion,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/politica-de-operacion';
import {
  ESTADOS_SUSCRIPCION,
  type EstadoSuscripcion,
} from '../../../src/modules/suscripciones-pagos/suscripciones/domain/suscripcion';

// T010 · PR25: PoliticaDeOperacion (FR-006, FR-007). La prueba LEE la tabla §1 del contrato
// specs/003-suscripciones-pagos/contracts/restricciones-estado.md y comprueba cada celda: el contrato es la
// fuente única. Una acción del dominio sin fila en la tabla, o una fila sin acción, hace fallar la prueba.

const CONTRATO = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '003-suscripciones-pagos',
  'contracts',
  'restricciones-estado.md',
);

interface Celda {
  accion: string;
  estado: string;
  permitido: boolean;
}

/** Celdas de la tabla de la sección "## 1." del contrato. */
function leerTabla(): { columnas: string[]; celdas: Celda[] } {
  const texto = readFileSync(CONTRATO, 'utf8');
  const seccion = texto.split(/^## /m).find((s) => s.startsWith('1.'));
  if (!seccion) throw new Error('El contrato no tiene la sección 1');
  const filas = seccion
    .split(/\r?\n/)
    .filter((l) => l.trim().startsWith('|'))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    );
  const [encabezado, , ...cuerpo] = filas;
  const columnas = encabezado.slice(1);
  const celdas = cuerpo.flatMap(([accion, ...valores]) =>
    valores.map((valor, i) => {
      if (valor !== '✓' && valor !== '✗') throw new Error(`Celda inválida "${valor}" en ${accion}`);
      return { accion: accion.replace(/`/g, ''), estado: columnas[i], permitido: valor === '✓' };
    }),
  );
  return { columnas, celdas };
}

describe('PR25 · PoliticaDeOperacion contra el contrato (FR-006)', () => {
  const { columnas, celdas } = leerTabla();

  it('la tabla tiene una columna por cada estado de la suscripción', () => {
    expect([...columnas].sort()).toEqual([...ESTADOS_SUSCRIPCION].sort());
  });

  it('cada acción del dominio tiene su fila, y cada fila es una acción del dominio', () => {
    const acciones = [...new Set(celdas.map((c) => c.accion))].sort();
    expect(acciones).toEqual([...ACCIONES_SUSCRIPCION].sort());
  });

  it.each(celdas.map((c) => [c.accion, c.estado, c.permitido] as const))(
    '%s en %s → %s',
    (accion, estado, permitido) => {
      expect(PoliticaDeOperacion.permite(estado as EstadoSuscripcion, accion as AccionSuscripcion)).toBe(
        permitido,
      );
    },
  );

  it('exigir lanza SUSCRIPCION_NO_PERMITE con el detalle { estado, accion } y el mensaje de la acción', () => {
    expect(() => PoliticaDeOperacion.exigir('ACTIVE', 'RESERVAR')).not.toThrow();
    let error: unknown;
    try {
      PoliticaDeOperacion.exigir('EXPIRED', 'RESERVAR');
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(SuscripcionNoPermite);
    const noPermite = error as SuscripcionNoPermite;
    expect(noPermite.codigo).toBe('SUSCRIPCION_NO_PERMITE');
    expect(noPermite.detalles).toEqual([{ estado: 'EXPIRED', accion: 'RESERVAR' }]);
    expect(noPermite.message).toBe('Esta barbería no acepta reservas por ahora');
    expect(noPermite.message).not.toMatch(/horario no disponible/i);
  });

  it.each(['CONFIGURAR_CATALOGO', 'GESTIONAR_USUARIOS'] as const)(
    'el resto de las acciones usa "Tu suscripción no permite este cambio" (%s)',
    (accion) => {
      expect(() => PoliticaDeOperacion.exigir('SUSPENDED', accion)).toThrow(
        'Tu suscripción no permite este cambio',
      );
    },
  );
});
