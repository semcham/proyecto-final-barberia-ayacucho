import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { filasDe, sembrarBarberia, sembrarCliente, sembrarUsuario } from '../helpers/fixtures';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import {
  bandeja,
  cerrarSolicitud,
  iniciarAtencion,
  misSolicitudes,
  registrarEnNombre,
  registrarSolicitud,
  sembrarSolicitudDatos,
} from '../helpers/solicitudes-datos';
import { pedirIndicadores } from '../helpers/indicadores';
import { cerrarPools } from '../helpers/test-db';

// T005 de 007 · PR08, FR-006, FR-022: las filas de specs/007-indicadores-datos-personales/contracts/rbac.md que ya
// existen (cada fase suma las suyas a IMPLEMENTADAS, como rbac-005). Columnas: PROPIETARIO, BARBERO, CLIENTE, sin
// sesión y el token de plataforma. ✓ → éxito; ✗ → 403 auditado para un rol de la barbería, y 401 sin sesión o con el
// token de la plataforma (en las rutas de barbería) o con un token de barbería (en la ruta de la plataforma).

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
  '007-indicadores-datos-personales',
  'contracts',
  'rbac.md',
);

interface Celda {
  simbolo: string;
  /** El estado escrito entre paréntesis en la celda, p. ej. "✗ (401)". */
  estado: number | null;
}

/** Filas de la tabla de rutas de rbac.md (la primera): ruta → celda de cada columna. */
function leerMatriz(): Map<string, Record<Columna, Celda>> {
  const filas = new Map<string, Record<Columna, Celda>>();
  const texto = readFileSync(RUTA_RBAC, 'utf8');
  const tabla = texto.slice(0, texto.indexOf('**Notas:**'));
  for (const linea of tabla.split(/\r?\n/)) {
    if (!/^\| `(GET|POST|PUT|PATCH|DELETE) /.test(linea)) continue;
    const celdas = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const celda = (c: string): Celda => {
      const estado = /\((\d{3})\)/.exec(c);
      return { simbolo: c.replace(/\s*\(.*\)$/, '').trim(), estado: estado ? Number(estado[1]) : null };
    };
    filas.set(celdas[0].replace(/`/g, ''), {
      PROPIETARIO: celda(celdas[1]),
      BARBERO: celda(celdas[2]),
      CLIENTE: celda(celdas[3]),
      ANONIMO: celda(celdas[4]),
      PLATAFORMA: celda(celdas[5]),
    });
  }
  return filas;
}

const MATRIZ = leerMatriz();

interface Escenario {
  tenantId: string;
  tokens: Record<Columna, string | null>;
  actores: Record<'PROPIETARIO' | 'BARBERO' | 'CLIENTE', string>;
  /** Cliente presencial de la barbería (para "en nombre de"). */
  presencialId: string;
  /** Solicitud RECIBIDA de la barbería (para las rutas con {id}). */
  solicitudId: string;
}

async function crearEscenario(): Promise<Escenario> {
  const b = await sembrarBarberia();
  const tenantId = b.tenantId;
  const barbero = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const cliente = await sesionCliente(tenantId);
  const presencial = await sembrarCliente({ tenantId, conCuenta: false, creadoPor: b.propietarioId });
  // De eliminación: así la de acceso que registra el cliente en su celda ✓ no choca con una abierta.
  const solicitudId = await sembrarSolicitudDatos({
    tenantId,
    registradaPor: cliente.cliente.usuarioId as string,
    clienteId: cliente.cliente.clienteId,
    tipo: 'ELIMINACION',
  });
  return {
    tenantId,
    tokens: {
      PROPIETARIO: await tokenPara(tenantId, b.propietarioId, 'PROPIETARIO'),
      BARBERO: await tokenPara(tenantId, barbero.usuarioId, 'BARBERO'),
      CLIENTE: cliente.token,
      ANONIMO: null,
      PLATAFORMA: (await tokenPlataformaPara(randomUUID())).token,
    },
    actores: {
      PROPIETARIO: b.propietarioId,
      BARBERO: barbero.usuarioId,
      CLIENTE: cliente.cliente.usuarioId as string,
    },
    presencialId: presencial.clienteId,
    solicitudId,
  };
}

interface Caso {
  fila: string;
  exito: number;
  ejecutar: (prueba: AppDePrueba, token: string | null, s: Escenario) => Promise<{ status: number }>;
}

/** Filas implementadas (fase 1: las seis de solicitudes; la fase 2b suma GET /plataforma/indicadores, abajo). */
const IMPLEMENTADAS: Caso[] = [
  {
    fila: 'POST /datos-personales/solicitudes',
    exito: 201,
    ejecutar: (p, t) => registrarSolicitud(p, t, { tipo: 'ACCESO' }),
  },
  {
    fila: 'GET /datos-personales/solicitudes/mias',
    exito: 200,
    ejecutar: (p, t) => misSolicitudes(p, t),
  },
  {
    fila: 'GET /datos-personales/solicitudes',
    exito: 200,
    ejecutar: (p, t) => bandeja(p, t),
  },
  {
    fila: 'POST /datos-personales/solicitudes/en-nombre',
    exito: 201,
    ejecutar: (p, t, s) => registrarEnNombre(p, t, { tipo: 'ACCESO', clienteId: s.presencialId }),
  },
  {
    fila: 'POST /datos-personales/solicitudes/{id}/atencion',
    exito: 200,
    ejecutar: (p, t, s) => iniciarAtencion(p, t, s.solicitudId),
  },
  {
    fila: 'POST /datos-personales/solicitudes/{id}/cierre',
    exito: 200,
    ejecutar: (p, t, s) =>
      cerrarSolicitud(p, t, s.solicitudId, { resultado: 'ATENDIDA', respuesta: 'Hecho a mano.' }),
  },
  // Fase 2b (T029): los indicadores, solo con el token de la plataforma; cualquier token de barbería → 401.
  {
    fila: 'GET /plataforma/indicadores',
    exito: 200,
    ejecutar: (p, t) => pedirIndicadores(p, t),
  },
];

function esperado(columna: Columna, celda: Celda, exito: number): number {
  if (celda.simbolo === '✓') return exito;
  if (celda.simbolo !== '✗') throw new Error(`Símbolo desconocido en rbac.md: "${celda.simbolo}"`);
  if (columna === 'ANONIMO' || columna === 'PLATAFORMA') return celda.estado ?? 401;
  return celda.estado ?? 403;
}

describe('PR08 · Matriz de permisos de 007 (contracts/rbac.md)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el contrato tiene las siete rutas y cada fila implementada existe en él', () => {
    expect([...MATRIZ.keys()].sort()).toEqual(
      [
        'GET /datos-personales/solicitudes',
        'GET /datos-personales/solicitudes/mias',
        'GET /plataforma/indicadores',
        'POST /datos-personales/solicitudes',
        'POST /datos-personales/solicitudes/en-nombre',
        'POST /datos-personales/solicitudes/{id}/atencion',
        'POST /datos-personales/solicitudes/{id}/cierre',
      ].sort(),
    );
    expect(IMPLEMENTADAS.map((c) => c.fila).filter((fila) => !MATRIZ.has(fila))).toEqual([]);
  });

  it('el propietario no registra sobre sí mismo; el barbero y el cliente no atienden (FR-005, FR-006)', () => {
    const simbolos = (fila: string) =>
      COLUMNAS.map((c) => (MATRIZ.get(fila) as Record<Columna, Celda>)[c].simbolo).join('');
    expect(simbolos('POST /datos-personales/solicitudes')).toBe('✗✓✓✗✗');
    expect(simbolos('GET /datos-personales/solicitudes/mias')).toBe('✗✓✓✗✗');
    for (const fila of [
      'GET /datos-personales/solicitudes',
      'POST /datos-personales/solicitudes/en-nombre',
      'POST /datos-personales/solicitudes/{id}/atencion',
      'POST /datos-personales/solicitudes/{id}/cierre',
    ]) {
      expect(simbolos(fila)).toBe('✓✗✗✗✗');
    }
    // Fase 2b: los indicadores son solo del administrador de la plataforma (FR-014).
    expect(simbolos('GET /plataforma/indicadores')).toBe('✗✗✗✗✓');
  });

  const casos = IMPLEMENTADAS.flatMap((caso) =>
    COLUMNAS.map((columna) => [caso.fila, columna, caso] as const),
  );

  it.each(casos)('%s · %s', async (_fila, columna, caso) => {
    const celda = (MATRIZ.get(caso.fila) as Record<Columna, Celda>)[columna];
    const estado = esperado(columna, celda, caso.exito);
    const s = await crearEscenario();
    const respuesta = await caso.ejecutar(prueba, s.tokens[columna], s);
    expect({ celda: celda.simbolo, estado: respuesta.status }).toEqual({ celda: celda.simbolo, estado });
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
