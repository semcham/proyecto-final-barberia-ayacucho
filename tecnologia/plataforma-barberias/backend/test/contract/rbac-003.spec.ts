import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDePrueba } from '../helpers/app';
import { filasDe, sembrarUsuario } from '../helpers/fixtures';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  iniciarEntornoDePagos,
  notificacionFirmada,
  PLAN_BASICO,
  RUTA_NOTIFICACIONES,
} from '../helpers/pagos';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T039 · PR08 de 003: cada celda de specs/003-suscripciones-pagos/contracts/rbac.md es un caso. La prueba lee
// la tabla y recorre las filas de IMPLEMENTADAS (cada fase de 003 agrega las suyas), con PROPIETARIO, BARBERO,
// CLIENTE, el token de plataforma (ADMIN) y sin token. ✓ → éxito; ✗ → 403 auditado; 401 → 401; pública → la
// ruta ignora el token.

type Columna = 'PROPIETARIO' | 'BARBERO' | 'CLIENTE' | 'ADMIN' | 'ANONIMO';
const COLUMNAS: Columna[] = ['PROPIETARIO', 'BARBERO', 'CLIENTE', 'ADMIN', 'ANONIMO'];

const RUTA_RBAC = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '003-suscripciones-pagos',
  'contracts',
  'rbac.md',
);

function leerMatriz(): Map<string, Record<Columna, string>> {
  const filas = new Map<string, Record<Columna, string>>();
  for (const linea of readFileSync(RUTA_RBAC, 'utf8').split(/\r?\n/)) {
    if (!linea.startsWith('| `') && !linea.startsWith('| **')) continue;
    const celdas = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    const simbolo = (c: string) =>
      c
        .replace(/\*\*/g, '')
        .replace(/\s*\(.*\)$/, '')
        .trim();
    filas.set(celdas[0], {
      PROPIETARIO: simbolo(celdas[1]),
      BARBERO: simbolo(celdas[2]),
      CLIENTE: simbolo(celdas[3]),
      ADMIN: simbolo(celdas[4]),
      ANONIMO: simbolo(celdas[5]),
    });
  }
  return filas;
}

interface Escenario {
  tenantId: string;
  tokens: Record<Columna, string | null>;
  actores: Record<'PROPIETARIO' | 'BARBERO' | 'CLIENTE', string>;
}

async function crearEscenario(): Promise<Escenario> {
  const b = await barberiaEnPrueba();
  const barbero = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const cliente = await sesionCliente(b.tenantId);
  return {
    tenantId: b.tenantId,
    tokens: {
      PROPIETARIO: b.token,
      BARBERO: await tokenPara(b.tenantId, barbero.usuarioId, 'BARBERO'),
      CLIENTE: cliente.token,
      ADMIN: (await tokenPlataformaPara(randomUUID())).token,
      ANONIMO: null,
    },
    actores: {
      PROPIETARIO: b.propietarioId,
      BARBERO: barbero.usuarioId,
      CLIENTE: cliente.cliente.usuarioId as string,
    },
  };
}

const con = (t: string | null) => (t ? { Authorization: `Bearer ${t}` } : {});

interface Caso {
  fila: string;
  exito: number;
  ejecutar: (p: AppDePrueba, token: string | null) => Promise<{ status: number }>;
}

/** Filas de rbac.md implementadas hasta esta fase (US1). */
const IMPLEMENTADAS: Caso[] = [
  { fila: '`GET /planes`', exito: 200, ejecutar: (p, t) => p.agente.get('/api/v1/planes').set(con(t)) },
  {
    fila: '`GET /suscripcion`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/suscripcion').set(con(t)),
  },
  {
    fila: '`GET /suscripcion/estado-operativo`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/suscripcion/estado-operativo').set(con(t)),
  },
  {
    fila: '`POST /suscripcion/pagos`',
    exito: 201,
    ejecutar: (p, t) =>
      p.agente.post('/api/v1/suscripcion/pagos').set(con(t)).send({ planId: PLAN_BASICO, medio: 'YAPE' }),
  },
  {
    fila: '`GET /suscripcion/pagos/{id}`',
    // Un id que no existe: el propietario pasa la autorización y recibe 404; los demás roles, 403 o 401.
    exito: 404,
    ejecutar: (p, t) => p.agente.get(`/api/v1/suscripcion/pagos/${randomUUID()}`).set(con(t)),
  },
  {
    fila: '`POST /pagos/notificaciones`',
    exito: 200,
    ejecutar: (p, t) => {
      const { cuerpo, firma } = notificacionFirmada({ referencia: `ses_rbac_${randomUUID()}` });
      return p.agente
        .post(RUTA_NOTIFICACIONES)
        .set({ ...con(t), 'Content-Type': 'application/json', 'X-Firma': firma })
        .send(cuerpo);
    },
  },
];

const MATRIZ = leerMatriz();

function esperado(simbolo: string, exito: number): number {
  if (simbolo === '✓' || simbolo === 'pública') return exito;
  if (simbolo === '✗') return 403;
  if (simbolo === '401') return 401;
  throw new Error(`Símbolo desconocido en rbac.md: "${simbolo}"`);
}

describe('PR08 · Matriz de permisos de 003 (contracts/rbac.md)', () => {
  let entorno: EntornoDePagos;

  beforeAll(async () => {
    entorno = await iniciarEntornoDePagos();
  });

  afterAll(async () => {
    await entorno.cerrar();
    await cerrarPools();
  });

  it('cada fila implementada existe en la tabla del contrato', () => {
    expect(MATRIZ.size).toBeGreaterThanOrEqual(20);
    expect(IMPLEMENTADAS.map((c) => c.fila).filter((fila) => !MATRIZ.has(fila))).toEqual([]);
  });

  const casos = IMPLEMENTADAS.flatMap((caso) =>
    COLUMNAS.map((columna) => [caso.fila, columna, caso] as const),
  );

  it.each(casos)('%s · %s', async (_fila, columna, caso) => {
    const simbolo = (MATRIZ.get(caso.fila) as Record<Columna, string>)[columna];
    const estado = esperado(simbolo, caso.exito);
    const s = await crearEscenario();
    const respuesta = await caso.ejecutar(entorno.prueba, s.tokens[columna]);
    expect({ celda: simbolo, estado: respuesta.status }).toEqual({ celda: simbolo, estado });
    if (estado === 403) {
      const denegaciones = (await filasDe('audit_log', s.tenantId)).filter(
        (f) => f.action === 'ACCESO_DENEGADO_ROL',
      );
      expect(denegaciones).toHaveLength(1);
      expect(denegaciones[0]).toMatchObject({
        actor_id: s.actores[columna as 'BARBERO'],
        result: 'DENEGADO',
      });
    }
  });
});
