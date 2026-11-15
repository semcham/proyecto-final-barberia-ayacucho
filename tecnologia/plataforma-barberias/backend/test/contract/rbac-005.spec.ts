import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { filasDe, sembrarUsuario } from '../helpers/fixtures';
import { preguntar } from '../helpers/asistente';
import { pedirReportes } from '../helpers/reportes';
import { barberiaParaReservar } from '../helpers/reservas';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T017 de 005 · PR08: las filas de specs/005-asistente-ia-reportes/contracts/rbac.md que ya existen (cada fase suma
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
  '005-asistente-ia-reportes',
  'contracts',
  'rbac.md',
);

/** Filas de la tabla de rutas de rbac.md (la primera): ruta → símbolo de cada columna. */
function leerMatriz(): Map<string, Record<Columna, string>> {
  const filas = new Map<string, Record<Columna, string>>();
  const texto = readFileSync(RUTA_RBAC, 'utf8');
  const tabla = texto.slice(0, texto.indexOf('**Herramientas por rol**'));
  for (const linea of tabla.split(/\r?\n/)) {
    if (!/^\| `(GET|POST|PUT|PATCH|DELETE) /.test(linea)) continue;
    const celdas = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const simbolo = (c: string) => c.replace(/\s*\(.*\)$/, '').trim();
    filas.set(celdas[0].replace(/`/g, ''), {
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

async function crearEscenario(): Promise<Escenario> {
  const e = await barberiaParaReservar();
  const tenantId = e.barberia.tenantId;
  const barbero = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const cliente = await sesionCliente(tenantId);
  return {
    tenantId,
    tokens: {
      PROPIETARIO: await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO'),
      BARBERO: await tokenPara(tenantId, barbero.usuarioId, 'BARBERO'),
      CLIENTE: cliente.token,
      ANONIMO: null,
      PLATAFORMA: (await tokenPlataformaPara(randomUUID())).token,
    },
    actores: {
      PROPIETARIO: e.barberia.propietarioId,
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

/** Filas implementadas (fase 2: los reportes; la fase 3 suma POST /asistente/mensajes). */
const IMPLEMENTADAS: Caso[] = [
  {
    fila: 'GET /reportes',
    exito: 200,
    ejecutar: (p, t) => pedirReportes(p, t, { desde: '2026-11-01', hasta: '2026-11-30' }),
  },
  // Fase 3 (US1): el asistente del cliente. El barbero no pasa el guardia (USAR_ASISTENTE).
  {
    fila: 'POST /asistente/mensajes',
    exito: 200,
    ejecutar: (p, t) => preguntar(p, t, '¿Qué servicios tienen?'),
  },
];

/**
 * Celdas ✓ del contrato que todavía no existen: el asistente del propietario es US3 (fase 4). Hasta entonces el
 * propietario pasa el guardia y el caso de uso responde 403, auditado (contracts/rbac.md: "403 del caso de uso").
 */
const PENDIENTES_DE_LA_FASE_4: Record<string, Columna[]> = { 'POST /asistente/mensajes': ['PROPIETARIO'] };

function esperado(columna: Columna, simbolo: string, exito: number, fila: string): number {
  if (simbolo === '✓' && PENDIENTES_DE_LA_FASE_4[fila]?.includes(columna)) return 403;
  if (simbolo === '✓') return exito;
  if (simbolo !== '✗') throw new Error(`Símbolo desconocido en rbac.md: "${simbolo}"`);
  return columna === 'ANONIMO' || columna === 'PLATAFORMA' ? 401 : 403;
}

describe('PR08 · Matriz de permisos de 005 (contracts/rbac.md)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el contrato tiene las dos rutas y cada fila implementada existe en él', () => {
    expect([...MATRIZ.keys()].sort()).toEqual(['GET /reportes', 'POST /asistente/mensajes']);
    expect(IMPLEMENTADAS.map((c) => c.fila).filter((fila) => !MATRIZ.has(fila))).toEqual([]);
  });

  it('GET /reportes es solo del propietario, como dice el contrato', () => {
    expect(MATRIZ.get('GET /reportes')).toEqual({
      PROPIETARIO: '✓',
      BARBERO: '✗',
      CLIENTE: '✗',
      ANONIMO: '✗',
      PLATAFORMA: '✗',
    });
  });

  const casos = IMPLEMENTADAS.flatMap((caso) =>
    COLUMNAS.map((columna) => [caso.fila, columna, caso] as const),
  );

  it.each(casos)('%s · %s', async (_fila, columna, caso) => {
    const simbolo = (MATRIZ.get(caso.fila) as Record<Columna, string>)[columna];
    const estado = esperado(columna, simbolo, caso.exito, caso.fila);
    const s = await crearEscenario();
    const respuesta = await caso.ejecutar(prueba, s.tokens[columna]);
    expect({ celda: simbolo, estado: respuesta.status }).toEqual({ celda: simbolo, estado });
    if (estado === 403) {
      const denegaciones = (await filasDe('audit_log', s.tenantId)).filter(
        (f) => f.action === 'ACCESO_DENEGADO_ROL',
      );
      expect(denegaciones).toHaveLength(1);
      expect(denegaciones[0]).toMatchObject({
        actor_id: s.actores[columna as 'PROPIETARIO' | 'BARBERO' | 'CLIENTE'],
        result: 'DENEGADO',
      });
    }
  });
});
