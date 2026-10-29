import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { AccesoBarberiasModule } from '../../src/modules/acceso-barberias/acceso-barberias.module';
import { CatalogoCitasModule } from '../../src/modules/catalogo-citas/catalogo-citas.module';
import { CLAVE_OPERACION } from '../../src/shared';
import type { AppDePrueba } from '../helpers/app';
import {
  hoyEnLima,
  iniciarTransferencia,
  numeroOperacion,
  pagoEnRevision,
  png,
} from '../helpers/comprobantes';
import { codigoPara, sembrarAdminPlataforma } from '../helpers/plataforma';
import { filasDe, sembrarPago, sembrarUsuario } from '../helpers/fixtures';
import {
  barberiaEnPrueba,
  type EntornoDePagos,
  iniciarEntornoDePagos,
  notificacionFirmada,
  PLAN_BASICO,
  RUTA_NOTIFICACIONES,
} from '../helpers/pagos';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools, poolDe } from '../helpers/test-db';

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
  /** En una fila con dos métodos (`PUT, DELETE …`), cuál prueba este caso. */
  metodo?: 'PUT' | 'DELETE';
  exito: number;
  /** `s`: la barbería del caso, para las filas que necesitan uno de sus pagos. */
  ejecutar: (p: AppDePrueba, token: string | null, s: Escenario) => Promise<{ status: number }>;
}

/** Pago en revisión de la barbería del escenario (lo crea su propietario). */
const enRevision = async (p: AppDePrueba, s: Escenario) =>
  (await pagoEnRevision(p, s.tokens.PROPIETARIO as string)).pagoId;

/** Id de la suscripción de la barbería del escenario. */
const suscripcionDe = async (s: Escenario): Promise<string> =>
  (await poolDe('seed').query('SELECT id FROM subscription WHERE tenant_id = $1', [s.tenantId])).rows[0].id;

const MOTIVO = { motivo: 'Prueba de la matriz de permisos' };

/** Todas las filas de rbac.md: US1 a US5, el ingreso del administrador y la notificación del proveedor. */
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
  // Fase 5 (T065): el ingreso del administrador es público y no usa el token que llegue (lo ignora).
  {
    fila: '`POST /plataforma/auth/ingresar`',
    exito: 200,
    ejecutar: async (p, t) => {
      const admin = await sembrarAdminPlataforma({ recuperacion: false });
      return p.agente
        .post('/api/v1/plataforma/auth/ingresar')
        .set(con(t))
        .send({ correo: admin.correo, contrasena: admin.contrasena });
    },
  },
  {
    fila: '`POST /plataforma/auth/segundo-factor`',
    exito: 200,
    ejecutar: async (p, t) => {
      const admin = await sembrarAdminPlataforma({ recuperacion: false });
      const { body } = await p.agente
        .post('/api/v1/plataforma/auth/ingresar')
        .send({ correo: admin.correo, contrasena: admin.contrasena })
        .expect(200);
      return p.agente
        .post('/api/v1/plataforma/auth/segundo-factor')
        .set(con(t))
        .send({ desafio: body.desafio, codigo: codigoPara(admin.secreto, new Date()) });
    },
  },
  // Fase 6 (T077): comprobantes del propietario y del administrador.
  {
    fila: '`POST /suscripcion/pagos/{id}/comprobante`',
    exito: 201,
    ejecutar: async (p, t, s) => {
      const iniciado = await iniciarTransferencia(p, s.tokens.PROPIETARIO as string).expect(201);
      const ruta = `/api/v1/suscripcion/pagos/${iniciado.body.pago.id}/comprobante`;
      return p.agente
        .post(ruta)
        .set(con(t))
        .attach('archivo', png(), { filename: 'comprobante.png' })
        .field('numeroOperacion', numeroOperacion())
        .field('fechaTransferencia', hoyEnLima());
    },
  },
  {
    fila: '`GET /suscripcion/pagos/{id}/comprobante`',
    exito: 200,
    ejecutar: async (p, t, s) => {
      const pagoId = await enRevision(p, s);
      return p.agente.get(`/api/v1/suscripcion/pagos/${pagoId}/comprobante`).set(con(t));
    },
  },
  {
    fila: '`GET /plataforma/comprobantes`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/plataforma/comprobantes').set(con(t)),
  },
  {
    fila: '`GET /plataforma/barberias/{id}/pagos/{pagoId}`',
    exito: 200,
    ejecutar: async (p, t, s) => {
      const pagoId = await enRevision(p, s);
      return p.agente.get(`/api/v1/plataforma/barberias/${s.tenantId}/pagos/${pagoId}`).set(con(t));
    },
  },
  {
    fila: '`GET /plataforma/barberias/{id}/pagos/{pagoId}/comprobante`',
    exito: 200,
    ejecutar: async (p, t, s) => {
      const pagoId = await enRevision(p, s);
      return p.agente
        .get(`/api/v1/plataforma/barberias/${s.tenantId}/pagos/${pagoId}/comprobante`)
        .set(con(t));
    },
  },
  {
    fila: '`POST /plataforma/barberias/{id}/pagos/{pagoId}/revision`',
    exito: 200,
    ejecutar: async (p, t, s) => {
      const pagoId = await enRevision(p, s);
      return p.agente
        .post(`/api/v1/plataforma/barberias/${s.tenantId}/pagos/${pagoId}/revision`)
        .set(con(t))
        .send({ resultado: 'APROBADO', importeTransferidoCentimos: 4900 });
    },
  },
  // Fase 7 (T087): historial del propietario y pagos por revisar del administrador.
  {
    fila: '`GET /suscripcion/pagos`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/suscripcion/pagos').set(con(t)),
  },
  {
    fila: '`GET /plataforma/pagos/por-revisar`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/plataforma/pagos/por-revisar').set(con(t)),
  },
  {
    fila: '`POST /plataforma/barberias/{id}/pagos/{pagoId}/revision/resolucion`',
    exito: 204,
    ejecutar: async (p, t, s) => {
      const { pagoId } = await sembrarPago({
        tenantId: s.tenantId,
        suscripcionId: await suscripcionDe(s),
        estado: 'APROBADO',
      });
      await poolDe('seed').query(`UPDATE payment SET review = 'DUPLICADO' WHERE id = $1`, [pagoId]);
      return p.agente
        .post(`/api/v1/plataforma/barberias/${s.tenantId}/pagos/${pagoId}/revision/resolucion`)
        .set(con(t))
        .send({ motivo: 'Devuelto fuera de la plataforma' });
    },
  },
  // Fase 8 (T094): administración de barberías y suscripciones, y activación manual.
  {
    fila: '`GET /plataforma/barberias`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/plataforma/barberias').set(con(t)),
  },
  {
    fila: '`PUT, DELETE /plataforma/barberias/{id}/suspension`',
    metodo: 'PUT',
    exito: 204,
    ejecutar: (p, t, s) =>
      p.agente.put(`/api/v1/plataforma/barberias/${s.tenantId}/suspension`).set(con(t)).send(MOTIVO),
  },
  {
    fila: '`PUT, DELETE /plataforma/barberias/{id}/suspension`',
    metodo: 'DELETE',
    exito: 204,
    ejecutar: async (p, t, s) => {
      await poolDe('seed').query(`UPDATE tenant SET status = 'SUSPENDIDA' WHERE id = $1`, [s.tenantId]);
      return p.agente.delete(`/api/v1/plataforma/barberias/${s.tenantId}/suspension`).set(con(t));
    },
  },
  {
    fila: '`PUT, DELETE /plataforma/barberias/{id}/suscripcion/suspension`',
    metodo: 'PUT',
    exito: 204,
    ejecutar: (p, t, s) =>
      p.agente
        .put(`/api/v1/plataforma/barberias/${s.tenantId}/suscripcion/suspension`)
        .set(con(t))
        .send(MOTIVO),
  },
  {
    fila: '`PUT, DELETE /plataforma/barberias/{id}/suscripcion/suspension`',
    metodo: 'DELETE',
    exito: 204,
    ejecutar: async (p, t, s) => {
      await poolDe('seed').query(
        `UPDATE subscription SET status = 'SUSPENDED', suspended_at = now(), suspension_reason = $2 WHERE id = $1`,
        [await suscripcionDe(s), MOTIVO.motivo],
      );
      return p.agente.delete(`/api/v1/plataforma/barberias/${s.tenantId}/suscripcion/suspension`).set(con(t));
    },
  },
  {
    fila: '`POST /plataforma/barberias/{id}/activacion-manual`',
    exito: 201,
    ejecutar: (p, t, s) =>
      p.agente
        .post(`/api/v1/plataforma/barberias/${s.tenantId}/activacion-manual`)
        .set(con(t))
        .send({ planId: PLAN_BASICO, ...MOTIVO, referenciaExterna: 'DEP-0001' }),
  },
  {
    fila: '`GET /plataforma/planes`',
    exito: 200,
    ejecutar: (p, t) => p.agente.get('/api/v1/plataforma/planes').set(con(t)),
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

type Metodo = 'get' | 'post' | 'put' | 'patch' | 'delete';
const METODOS: Partial<Record<RequestMethod, Metodo>> = {
  [RequestMethod.GET]: 'get',
  [RequestMethod.POST]: 'post',
  [RequestMethod.PUT]: 'put',
  [RequestMethod.PATCH]: 'patch',
  [RequestMethod.DELETE]: 'delete',
};

/** Rutas con @Operacion de los controladores de M01 y M02, con un UUID cualquiera en cada parámetro. */
function rutasConOperacion(prueba: AppDePrueba): { metodo: Metodo; ruta: string }[] {
  const modulos = [AccesoBarberiasModule, CatalogoCitasModule] as unknown[];
  const rutas: { metodo: Metodo; ruta: string }[] = [];
  for (const modulo of prueba.app.get(ModulesContainer).values()) {
    if (!modulos.includes(modulo.metatype)) continue;
    for (const { metatype } of modulo.controllers.values()) {
      const controlador = metatype as { prototype: Record<string, unknown> };
      const base = String(Reflect.getMetadata(PATH_METADATA, controlador) ?? '');
      for (const nombre of Object.getOwnPropertyNames(controlador.prototype)) {
        const manejador = controlador.prototype[nombre];
        if (typeof manejador !== 'function' || !Reflect.getMetadata(CLAVE_OPERACION, manejador)) continue;
        const metodo = METODOS[Reflect.getMetadata(METHOD_METADATA, manejador) as RequestMethod];
        if (!metodo) throw new Error(`Método HTTP no previsto en ${nombre}`);
        const propia = String(Reflect.getMetadata(PATH_METADATA, manejador) ?? '');
        const ruta = `/api/v1/${[base, propia].filter((p) => p && p !== '/').join('/')}`
          .replace(/\/+/g, '/')
          .replace(/:[A-Za-z]+/g, () => randomUUID());
        rutas.push({ metodo, ruta });
      }
    }
  }
  return rutas;
}

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

  // T094 · La tabla se recorre completa: una fila nueva en rbac.md sin su caso hace fallar la prueba. La fila
  // "Cualquier ruta de 001 y 002" tiene su propia prueba (abajo), que recorre las rutas de la aplicación.
  it('toda fila de la tabla tiene su caso, y una fila con dos métodos tiene uno por método', () => {
    const conCaso = new Set(IMPLEMENTADAS.map((c) => c.fila));
    const sinCaso = [...MATRIZ.keys()].filter(
      (fila) => !conCaso.has(fila) && !fila.startsWith('**Cualquier ruta de 001 y 002 con token**'),
    );
    expect(sinCaso).toEqual([]);

    for (const fila of MATRIZ.keys()) {
      const metodos = /^`([A-Z]+(?:, [A-Z]+)+) /.exec(fila)?.[1].split(', ');
      if (!metodos) continue;
      const cubiertos = IMPLEMENTADAS.filter((c) => c.fila === fila).map((c) => c.metodo);
      expect({ fila, metodos: [...cubiertos].sort() }).toEqual({ fila, metodos: [...metodos].sort() });
    }
  });

  const casos = IMPLEMENTADAS.flatMap((caso) =>
    COLUMNAS.map(
      (columna) => [caso.metodo ? `${caso.fila} (${caso.metodo})` : caso.fila, columna, caso] as const,
    ),
  );

  // T065 · Fila "Cualquier ruta de 001 y 002 con token": el token del administrador responde 401 en TODAS las
  // rutas con @Operacion de M01 y M02. Las rutas se leen de la aplicación (metadatos de Nest), así que una
  // ruta nueva de 001 o 002 entra sola en la prueba.
  describe('el token del administrador en las rutas de 001 y 002', () => {
    const FILA = [...MATRIZ.keys()].find((fila) =>
      fila.startsWith('**Cualquier ruta de 001 y 002 con token**'),
    );

    it('la fila existe en el contrato y dice 401 para ADMIN', () => {
      expect(FILA).toBeDefined();
      expect(MATRIZ.get(FILA as string)?.ADMIN).toBe('401');
    });

    it('todas las rutas con @Operacion de M01 y M02 responden 401 al token del administrador', async () => {
      const rutas = rutasConOperacion(entorno.prueba);
      // M01 (auth, usuarios, barbería, clientes) y M02 (catálogo, disponibilidad, citas, agenda, historial).
      expect(rutas.length).toBeGreaterThanOrEqual(25);
      const { token } = await tokenPlataformaPara();
      const resultados = await Promise.all(
        rutas.map(async ({ metodo, ruta }) => {
          const respuesta = await entorno.prueba.agente[metodo](ruta).set(con(token)).send({});
          return {
            ruta: `${metodo.toUpperCase()} ${ruta}`,
            estado: respuesta.status,
            codigo: respuesta.body.codigo,
          };
        }),
      );
      expect(resultados.filter((r) => r.estado !== 401 || r.codigo !== 'NO_AUTENTICADO')).toEqual([]);
    });
  });

  it.each(casos)('%s · %s', async (_fila, columna, caso) => {
    const simbolo = (MATRIZ.get(caso.fila) as Record<Columna, string>)[columna];
    const estado = esperado(simbolo, caso.exito);
    const s = await crearEscenario();
    const respuesta = await caso.ejecutar(entorno.prueba, s.tokens[columna], s);
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
