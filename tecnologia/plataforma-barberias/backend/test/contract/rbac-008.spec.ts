import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cambiarConfiguracion, subirQr, verConfiguracion, verQr } from '../helpers/adelantos';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { png } from '../helpers/comprobantes';
import { filasDe, sembrarUsuario } from '../helpers/fixtures';
import { barberiaEnPrueba } from '../helpers/pagos';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T013 de 008 · PR08: las filas de specs/008-adelanto-reserva-qr/contracts/rbac.md que ya existen (cada fase suma
// las suyas a IMPLEMENTADAS). Columnas: PROPIETARIO, BARBERO, CLIENTE, sin sesión y el token de plataforma.
// ✓ → éxito; ✗ → 403 auditado para un rol de la barbería, y 401 sin sesión o con el token de plataforma.

type Columna = 'PROPIETARIO' | 'BARBERO' | 'CLIENTE' | 'ANONIMO' | 'PLATAFORMA';
const COLUMNAS: Columna[] = ['PROPIETARIO', 'BARBERO', 'CLIENTE', 'ANONIMO', 'PLATAFORMA'];

const RUTA_RBAC = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '008-adelanto-reserva-qr',
  'contracts',
  'rbac.md',
);

/** Filas de la primera tabla de rbac.md (la de las rutas): ruta → símbolo de cada columna. */
function leerMatriz(): Map<string, Record<Columna, string>> {
  const filas = new Map<string, Record<Columna, string>>();
  const texto = readFileSync(RUTA_RBAC, 'utf8');
  const tabla = texto.slice(0, texto.indexOf('**Cambios a rutas existentes'));
  for (const linea of tabla.split(/\r?\n/)) {
    if (!linea.startsWith('| `')) continue;
    const celdas = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const simbolo = (c: string) => c.replace(/\s*\(.*\)$/, '').trim();
    filas.set(celdas[0].replace(/`/g, '').replace(/\s*\(.*\)$/, ''), {
      PROPIETARIO: simbolo(celdas[1]),
      BARBERO: simbolo(celdas[2]),
      CLIENTE: simbolo(celdas[3]),
      ANONIMO: simbolo(celdas[4]),
      PLATAFORMA: simbolo(celdas[5]),
    });
  }
  return filas;
}

const MATRIZ = leerMatriz();

interface Escenario {
  tenantId: string;
  tokens: Record<Columna, string | null>;
  actores: Record<'PROPIETARIO' | 'BARBERO' | 'CLIENTE', string>;
}

/** Barbería en prueba con su QR ya subido, un barbero y un cliente. */
async function crearEscenario(prueba: AppDePrueba): Promise<Escenario> {
  const b = await barberiaEnPrueba();
  await subirQr(prueba, b.token, png()).expect(200);
  const barbero = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const cliente = await sesionCliente(b.tenantId);
  return {
    tenantId: b.tenantId,
    tokens: {
      PROPIETARIO: b.token,
      BARBERO: await tokenPara(b.tenantId, barbero.usuarioId, 'BARBERO'),
      CLIENTE: cliente.token,
      ANONIMO: null,
      PLATAFORMA: (await tokenPlataformaPara(randomUUID())).token,
    },
    actores: {
      PROPIETARIO: b.propietarioId,
      BARBERO: barbero.usuarioId,
      CLIENTE: cliente.cliente.usuarioId as string,
    },
  };
}

interface Caso {
  fila: string;
  exito: number;
  ejecutar: (prueba: AppDePrueba, token: string | null) => Promise<{ status: number }>;
}

/** Filas implementadas (fase 2: configuración del adelanto). */
const IMPLEMENTADAS: Caso[] = [
  { fila: 'GET /barberia/adelanto', exito: 200, ejecutar: (p, t) => verConfiguracion(p, t) },
  {
    fila: 'PUT /barberia/adelanto',
    exito: 200,
    ejecutar: (p, t) =>
      cambiarConfiguracion(p, t, { activo: true, tipo: 'FIJO', montoCentimos: 1000, plazoMinutos: 30 }),
  },
  { fila: 'PUT /barberia/adelanto/qr', exito: 200, ejecutar: (p, t) => subirQr(p, t, png()) },
  { fila: 'GET /barberia/adelanto/qr', exito: 200, ejecutar: (p, t) => verQr(p, t) },
];

function esperado(columna: Columna, simbolo: string, exito: number): number {
  if (simbolo === '✓') return exito;
  if (simbolo !== '✗') throw new Error(`Símbolo desconocido en rbac.md: "${simbolo}"`);
  return columna === 'ANONIMO' || columna === 'PLATAFORMA' ? 401 : 403;
}

describe('PR08 · Matriz de permisos de 008 (contracts/rbac.md)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('cada fila implementada existe en la tabla del contrato', () => {
    expect(MATRIZ.size).toBeGreaterThanOrEqual(13);
    expect(IMPLEMENTADAS.map((c) => c.fila).filter((fila) => !MATRIZ.has(fila))).toEqual([]);
  });

  it('las rutas de configuración son solo del propietario, como dice el contrato', () => {
    for (const { fila } of IMPLEMENTADAS) {
      expect({ fila, ...MATRIZ.get(fila) }).toEqual({
        fila,
        PROPIETARIO: '✓',
        BARBERO: '✗',
        CLIENTE: '✗',
        ANONIMO: '✗',
        PLATAFORMA: '✗',
      });
    }
  });

  const casos = IMPLEMENTADAS.flatMap((caso) =>
    COLUMNAS.map((columna) => [caso.fila, columna, caso] as const),
  );

  it.each(casos)('%s · %s', async (_fila, columna, caso) => {
    const simbolo = (MATRIZ.get(caso.fila) as Record<Columna, string>)[columna];
    const estado = esperado(columna, simbolo, caso.exito);
    const s = await crearEscenario(prueba);
    const respuesta = await caso.ejecutar(prueba, s.tokens[columna]);
    expect({ celda: simbolo, estado: respuesta.status }).toEqual({ celda: simbolo, estado });
    if (estado === 403) {
      const denegaciones = (await filasDe('audit_log', s.tenantId)).filter(
        (f) => f.action === 'ACCESO_DENEGADO_ROL',
      );
      expect(denegaciones).toHaveLength(1);
      expect(denegaciones[0]).toMatchObject({
        actor_id: s.actores[columna as 'BARBERO' | 'CLIENTE'],
        result: 'DENEGADO',
      });
    }
  });
});
