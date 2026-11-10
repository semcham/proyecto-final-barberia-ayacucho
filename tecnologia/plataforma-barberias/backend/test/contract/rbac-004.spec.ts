import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AccionDeEnlace } from '../../src/shared/enlaces-firmados';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { emitirEnlace, ipUnica } from '../helpers/enlaces';
import { filasDe, sembrarCita, sembrarUsuario } from '../helpers/fixtures';
import { barberiaParaReservar, fechaEnDias, horaLima } from '../helpers/reservas';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T041 · PR08 de 004: las filas de specs/004-notificaciones-reprogramacion/contracts/rbac.md que ya existen
// (cada fase agrega las suyas a IMPLEMENTADAS). Columnas: PROPIETARIO, BARBERO, CLIENTE, sin sesión y el token
// de plataforma. ✓ → éxito; ✗ → 403 auditado para un rol de la barbería, 401 sin sesión o con el token de
// plataforma, y 404 para el cliente con la cita de otra persona (sin revelar que existe).

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
  '004-notificaciones-reprogramacion',
  'contracts',
  'rbac.md',
);

function leerMatriz(): Map<string, Record<Columna, string>> {
  const filas = new Map<string, Record<Columna, string>>();
  for (const linea of readFileSync(RUTA_RBAC, 'utf8').split(/\r?\n/)) {
    if (!linea.startsWith('| `')) continue;
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
  citaDelCliente: string;
  citaDeOtro: string;
}

async function crearEscenario(): Promise<Escenario> {
  const e = await barberiaParaReservar();
  const tenantId = e.barberia.tenantId;
  const barbero = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
  const cliente = await sesionCliente(tenantId);
  const otro = await sesionCliente(tenantId);
  const cita = (clienteId: string, hora: string) =>
    sembrarCita({
      tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId,
      inicio: new Date(horaLima(fechaEnDias(3), hora)),
    });
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
    citaDelCliente: await cita(cliente.cliente.clienteId, '10:00'),
    citaDeOtro: await cita(otro.cliente.clienteId, '11:00'),
  };
}

interface Caso {
  fila: string;
  /** Estado de éxito de la celda ✓. */
  exito: number;
  ejecutar: (
    prueba: AppDePrueba,
    token: string | null,
    s: Escenario,
  ) => Promise<{ status: number; body: Record<string, unknown> }>;
}

const reprogramar = (prueba: AppDePrueba, token: string | null, citaId: string) => {
  const solicitud = prueba.agente.post(`/api/v1/citas/${citaId}/reprogramar`);
  if (token) solicitud.set({ Authorization: `Bearer ${token}` });
  return solicitud.send({ inicio: horaLima(fechaEnDias(3), '15:00') });
};

/**
 * Fase 4 (T085): una ruta de enlaces con un enlace VÁLIDO de la cita del cliente y, si la columna lo trae, el token
 * de sesión, que la ruta debe ignorar ("—" en rbac.md). Cada caso usa su propia IP (contador de rechazos por IP).
 */
const conEnlace =
  (accion: AccionDeEnlace, metodo: 'get' | 'post', ruta: string, cuerpo?: object) =>
  (prueba: AppDePrueba, token: string | null, s: Escenario) => {
    const enlace = emitirEnlace(prueba, {
      tenantId: s.tenantId,
      citaId: s.citaDelCliente,
      accion,
      venceEn: new Date(horaLima(fechaEnDias(3), '10:00')),
    });
    const solicitud = prueba.agente[metodo](`/api/v1${ruta}`).set({
      'X-Enlace-Accion': enlace,
      'X-Forwarded-For': ipUnica(),
    });
    if (token) solicitud.set({ Authorization: `Bearer ${token}` });
    return metodo === 'post' ? solicitud.send(cuerpo ?? {}) : solicitud;
  };

/** Filas de rbac.md ya implementadas (fase 2: reprogramar; fase 4: acciones por enlace). */
const IMPLEMENTADAS: Caso[] = [
  {
    fila: 'POST /citas/{id}/reprogramar',
    exito: 200,
    ejecutar: (prueba, token, s) => reprogramar(prueba, token, s.citaDelCliente),
  },
  { fila: 'GET /enlaces/accion', exito: 200, ejecutar: conEnlace('CONFIRMAR', 'get', '/enlaces/accion') },
  {
    fila: 'POST /enlaces/accion/confirmar',
    exito: 200,
    ejecutar: conEnlace('CONFIRMAR', 'post', '/enlaces/accion/confirmar'),
  },
  {
    fila: 'POST /enlaces/accion/cancelar',
    exito: 200,
    ejecutar: conEnlace('CANCELAR', 'post', '/enlaces/accion/cancelar'),
  },
  {
    fila: 'POST /enlaces/accion/reprogramar',
    exito: 200,
    ejecutar: conEnlace('REPROGRAMAR', 'post', '/enlaces/accion/reprogramar', {
      inicio: horaLima(fechaEnDias(3), '16:00'),
    }),
  },
];

function esperado(columna: Columna, simbolo: string, exito: number): number {
  if (simbolo === '✓') return exito;
  // "—": la ruta no usa el token de sesión (lo ignora aunque llegue): manda el enlace, que es válido.
  if (simbolo === '—') return exito;
  if (simbolo !== '✗') throw new Error(`Símbolo desconocido en rbac.md: "${simbolo}"`);
  // Sin sesión y con el token de plataforma no hay barbería: 401 (AuthGuard de 003).
  return columna === 'ANONIMO' || columna === 'PLATAFORMA' ? 401 : 403;
}

describe('PR08 · Matriz de permisos de 004 (contracts/rbac.md)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('cada fila implementada existe en la tabla del contrato', () => {
    expect(MATRIZ.size).toBeGreaterThanOrEqual(8);
    expect(IMPLEMENTADAS.map((c) => c.fila).filter((fila) => !MATRIZ.has(fila))).toEqual([]);
  });

  const casos = IMPLEMENTADAS.flatMap((caso) =>
    COLUMNAS.map((columna) => [caso.fila, columna, caso] as const),
  );

  it.each(casos)('%s · %s', async (_fila, columna, caso) => {
    const simbolo = (MATRIZ.get(caso.fila) as Record<Columna, string>)[columna];
    const estado = esperado(columna, simbolo, caso.exito);
    const s = await crearEscenario();
    const respuesta = await caso.ejecutar(prueba, s.tokens[columna], s);
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

  it('POST /citas/{id}/reprogramar · CLIENTE con la cita de otro cliente → 404 sin revelar que existe', async () => {
    const s = await crearEscenario();
    const respuesta = await reprogramar(prueba, s.tokens.CLIENTE, s.citaDeOtro);
    expect(respuesta.status).toBe(404);
    expect(respuesta.body.codigo).toBe('NO_ENCONTRADO');
    const inexistente = await reprogramar(prueba, s.tokens.CLIENTE, randomUUID());
    expect(inexistente.body).toEqual(respuesta.body);
  });

  it('POST /citas/{id}/reprogramar · PROPIETARIO con una cita de otra barbería → 404', async () => {
    const s = await crearEscenario();
    const otra = await crearEscenario();
    const respuesta = await reprogramar(prueba, otra.tokens.PROPIETARIO, s.citaDelCliente);
    expect(respuesta.status).toBe(404);
  });
});
