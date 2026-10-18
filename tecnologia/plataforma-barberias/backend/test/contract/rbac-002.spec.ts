import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AppDePrueba, crearApp } from '../helpers/app';
import {
  filasDe,
  sembrarBloqueo,
  sembrarCita,
  sembrarCliente,
  sembrarDisponibilidad,
} from '../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
  nuevaClave,
  SEMANA_COMPLETA,
} from '../helpers/reservas';
import { sesionBarberoVinculado, sesionCliente, tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// PR08 de la funcionalidad 002: cada celda de specs/002-catalogo-citas-cliente/contracts/rbac.md es un caso.
// El estado esperado se lee de la tabla (✓ y ✓* → éxito; — → 403 auditado; 401 → sin sesión), así que un
// cambio en la matriz que no se refleje en el código hace fallar la prueba. Otra prueba exige que cada fila
// de la tabla tenga al menos un caso.

type Rol = 'PUB' | 'PROPIETARIO' | 'BARBERO' | 'CLIENTE';
const ROLES: Rol[] = ['PUB', 'PROPIETARIO', 'BARBERO', 'CLIENTE'];

const RUTA_RBAC = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'specs',
  '002-catalogo-citas-cliente',
  'contracts',
  'rbac.md',
);

/** Filas de la tabla de rbac.md: operación (texto de la primera columna) → símbolo por rol. */
function leerMatriz(): Map<string, Record<Rol, string>> {
  const filas = new Map<string, Record<Rol, string>>();
  for (const linea of readFileSync(RUTA_RBAC, 'utf8').split(/\r?\n/)) {
    if (!linea.startsWith('| `')) continue;
    const celdas = linea
      .split('|')
      .slice(1, -1)
      .map((c) => c.trim());
    // Quita notas al pie (superíndices) y los escapes de Markdown (✓\*).
    const simbolo = (c: string) =>
      c
        .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, '')
        .replace(/\\/g, '')
        .trim();
    filas.set(celdas[0], {
      PUB: simbolo(celdas[1]),
      PROPIETARIO: simbolo(celdas[2]),
      BARBERO: simbolo(celdas[3]),
      CLIENTE: simbolo(celdas[4]),
    });
  }
  return filas;
}

interface Escenario {
  e: BarberiaParaReservar;
  barberoVinculado: { usuarioId: string; barberoId: string; token: string };
  cliente: Awaited<ReturnType<typeof sesionCliente>>;
  tokens: Record<Exclude<Rol, 'PUB'>, string>;
  actores: Record<Exclude<Rol, 'PUB'>, string>;
}

/**
 * Barbería lista para todas las operaciones: catálogo, un barbero vinculado a un usuario BARBERO (con
 * disponibilidad: sus celdas ✓* operan sobre él) y un cliente con cuenta y sesión.
 */
async function crearEscenario(): Promise<Escenario> {
  const e = await barberiaParaReservar();
  const barberoVinculado = await sesionBarberoVinculado(e.barberia.tenantId, [e.servicioId]);
  await sembrarDisponibilidad(e.barberia.tenantId, barberoVinculado.barberoId, SEMANA_COMPLETA);
  const cliente = await sesionCliente(e.barberia.tenantId);
  const tokenPropietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  return {
    e,
    barberoVinculado,
    cliente,
    tokens: { PROPIETARIO: tokenPropietario, BARBERO: barberoVinculado.token, CLIENTE: cliente.token },
    actores: {
      PROPIETARIO: e.barberia.propietarioId,
      BARBERO: barberoVinculado.usuarioId,
      CLIENTE: cliente.cliente.usuarioId as string,
    },
  };
}

type Ejecutar = (p: AppDePrueba, s: Escenario, rol: Rol, token: string | null) => Promise<{ status: number }>;

interface Caso {
  /** Texto de la primera columna de la fila de rbac.md que cubre. */
  fila: string;
  nombre: string;
  /** Estado de éxito de las celdas ✓ y ✓*. */
  exito: number;
  ejecutar: Ejecutar;
}

const con = (t: string | null) => (t ? { Authorization: `Bearer ${t}` } : {});
const fecha = fechaEnDias(3);
const unico = () => randomBytes(4).toString('hex');
const tramos = [0, 1, 2, 3, 4, 5, 6].map((diaSemana) => ({ diaSemana, inicio: '09:00', fin: '19:00' }));

/** Cita del cliente del escenario con el barbero vinculado, `dias` desde hoy a las `hora`. */
const citaDelCliente = (s: Escenario, dias: number, hora: string) =>
  sembrarCita({
    tenantId: s.e.barberia.tenantId,
    barberoId: s.barberoVinculado.barberoId,
    servicioId: s.e.servicioId,
    clienteId: s.cliente.cliente.clienteId,
    inicio: new Date(horaLima(fechaEnDias(dias), hora)),
  });

const CASOS: Caso[] = [
  {
    fila: '`GET /publico/{slug}`',
    nombre: 'GET /publico/{slug}',
    exito: 200,
    ejecutar: (p, s, _r, t) => p.agente.get(`/api/v1/publico/${s.e.barberia.slug}`).set(con(t)),
  },
  {
    fila: '`GET /publico/{slug}/horarios`',
    nombre: 'GET /publico/{slug}/horarios',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente
        .get(`/api/v1/publico/${s.e.barberia.slug}/horarios?servicio=${s.e.servicioId}&fecha=${fecha}`)
        .set(con(t)),
  },
  {
    fila: '`POST /clientes/registro`',
    nombre: 'POST /clientes/registro',
    exito: 201,
    ejecutar: (p, s, _r, t) =>
      p.agente
        .post('/api/v1/clientes/registro')
        .set(con(t))
        .send({
          barberia: s.e.barberia.slug,
          nombre: 'Cliente Nuevo',
          correo: `rbac-${unico()}@prueba.pe`,
          telefono: '966111222',
          contrasena: 'una clave larga y propia',
          aceptaPoliticaDatos: true,
          versionPoliticaDatos: '2026-10',
        }),
  },
  {
    fila: '`POST /auth/login` (con o sin `barberia`)',
    nombre: 'POST /auth/login (cliente con barberia)',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente.post('/api/v1/auth/login').set(con(t)).send({
        correo: s.cliente.cliente.correo,
        contrasena: s.cliente.cliente.contrasena,
        barberia: s.e.barberia.slug,
      }),
  },
  {
    fila: '`POST /auth/login` (con o sin `barberia`)',
    nombre: 'POST /auth/login (personal sin barberia)',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente
        .post('/api/v1/auth/login')
        .set(con(t))
        .send({ correo: s.e.barberia.correo, contrasena: s.e.barberia.contrasena }),
  },
  {
    fila: '`POST /auth/barberia`',
    nombre: 'POST /auth/barberia (unirse a otra barbería)',
    exito: 200,
    ejecutar: async (p, _s, _r, t) => {
      const otra = await barberiaParaReservar();
      return p.agente.post('/api/v1/auth/barberia').set(con(t)).send({
        barberia: otra.barberia.slug,
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: '2026-10',
        telefono: '966111222',
      });
    },
  },
  {
    fila: '`POST /auth/logout`, `GET /auth/yo` (001)',
    nombre: 'GET /auth/yo',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/auth/yo').set(con(t)),
  },
  {
    fila: '`POST /auth/logout`, `GET /auth/yo` (001)',
    nombre: 'POST /auth/logout',
    exito: 204,
    ejecutar: (p, _s, _r, t) => p.agente.post('/api/v1/auth/logout').set(con(t)),
  },
  {
    fila: '`GET /barberia`, `GET /barberia/horario`',
    nombre: 'GET /barberia',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/barberia').set(con(t)),
  },
  {
    fila: '`GET /barberia`, `GET /barberia/horario`',
    nombre: 'GET /barberia/horario',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/barberia/horario').set(con(t)),
  },
  {
    fila: '`PATCH /barberia`, `PUT /barberia/horario`',
    nombre: 'PATCH /barberia',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.patch('/api/v1/barberia').set(con(t)).send({ descripcion: 'Nueva' }),
  },
  {
    fila: '`PATCH /barberia`, `PUT /barberia/horario`',
    nombre: 'PUT /barberia/horario',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.put('/api/v1/barberia/horario').set(con(t)).send({ tramos }),
  },
  {
    fila: '`GET /servicios`, `GET /barberos`',
    nombre: 'GET /servicios',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/servicios').set(con(t)),
  },
  {
    fila: '`GET /servicios`, `GET /barberos`',
    nombre: 'GET /barberos',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/barberos').set(con(t)),
  },
  {
    fila: '`POST /servicios`, `PATCH /servicios/{id}`',
    nombre: 'POST /servicios',
    exito: 201,
    ejecutar: (p, _s, _r, t) =>
      p.agente
        .post('/api/v1/servicios')
        .set(con(t))
        .send({ nombre: `Servicio ${unico()}`, precio: '10', duracionMinutos: 30 }),
  },
  {
    fila: '`POST /servicios`, `PATCH /servicios/{id}`',
    nombre: 'PATCH /servicios/{id}',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente.patch(`/api/v1/servicios/${s.e.servicioId}`).set(con(t)).send({ precio: '22' }),
  },
  {
    fila: '`POST /barberos`, `PATCH /barberos/{id}`',
    nombre: 'POST /barberos',
    exito: 201,
    ejecutar: (p, _s, _r, t) =>
      p.agente
        .post('/api/v1/barberos')
        .set(con(t))
        .send({ nombre: `Barbero ${unico()}`, servicioIds: [] }),
  },
  {
    fila: '`POST /barberos`, `PATCH /barberos/{id}`',
    nombre: 'PATCH /barberos/{id}',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente.patch(`/api/v1/barberos/${s.e.barberoId}`).set(con(t)).send({ nombre: 'Luis Editado' }),
  },
  {
    fila: '`GET`/`PUT /barberos/{id}/disponibilidad`',
    nombre: 'GET /barberos/{id}/disponibilidad (barbero vinculado)',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente.get(`/api/v1/barberos/${s.barberoVinculado.barberoId}/disponibilidad`).set(con(t)),
  },
  {
    fila: '`GET`/`PUT /barberos/{id}/disponibilidad`',
    nombre: 'PUT /barberos/{id}/disponibilidad (barbero vinculado)',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente
        .put(`/api/v1/barberos/${s.barberoVinculado.barberoId}/disponibilidad`)
        .set(con(t))
        .send({ tramos }),
  },
  {
    fila: '`GET`/`POST /barberos/{id}/bloqueos`, `DELETE …/{bloqueoId}`',
    nombre: 'GET /barberos/{id}/bloqueos (barbero vinculado)',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente.get(`/api/v1/barberos/${s.barberoVinculado.barberoId}/bloqueos`).set(con(t)),
  },
  {
    fila: '`GET`/`POST /barberos/{id}/bloqueos`, `DELETE …/{bloqueoId}`',
    nombre: 'POST /barberos/{id}/bloqueos (barbero vinculado)',
    exito: 201,
    ejecutar: (p, s, _r, t) =>
      p.agente
        .post(`/api/v1/barberos/${s.barberoVinculado.barberoId}/bloqueos`)
        .set(con(t))
        .send({ inicio: horaLima(fechaEnDias(9), '10:00'), fin: horaLima(fechaEnDias(9), '11:00') }),
  },
  {
    fila: '`GET`/`POST /barberos/{id}/bloqueos`, `DELETE …/{bloqueoId}`',
    nombre: 'DELETE /barberos/{id}/bloqueos/{bloqueoId} (barbero vinculado)',
    exito: 204,
    ejecutar: async (p, s, _r, t) => {
      const bloqueoId = await sembrarBloqueo({
        tenantId: s.e.barberia.tenantId,
        barberoId: s.barberoVinculado.barberoId,
        inicio: new Date(horaLima(fechaEnDias(10), '10:00')),
        fin: new Date(horaLima(fechaEnDias(10), '11:00')),
      });
      return p.agente
        .delete(`/api/v1/barberos/${s.barberoVinculado.barberoId}/bloqueos/${bloqueoId}`)
        .set(con(t));
    },
  },
  {
    fila: '`GET /horarios`',
    nombre: 'GET /horarios',
    exito: 200,
    ejecutar: (p, s, _r, t) =>
      p.agente.get(`/api/v1/horarios?servicio=${s.e.servicioId}&fecha=${fecha}`).set(con(t)),
  },
  {
    fila: '`POST /citas`',
    nombre: 'POST /citas (presencial del propietario o propia del cliente)',
    exito: 201,
    ejecutar: async (p, s, rol, t) => {
      const cuerpo: Record<string, string> = {
        servicioId: s.e.servicioId,
        barberoId: s.barberoVinculado.barberoId,
        inicio: horaLima(fecha, '10:00'),
      };
      // Nota 4: el propietario registra la cita presencial de un cliente de su barbería.
      if (rol === 'PROPIETARIO') {
        cuerpo.clienteId = (
          await sembrarCliente({ tenantId: s.e.barberia.tenantId, conCuenta: false })
        ).clienteId;
      }
      return p.agente
        .post('/api/v1/citas')
        .set({ ...con(t), 'Idempotency-Key': nuevaClave() })
        .send(cuerpo);
    },
  },
  {
    fila: '`POST /citas/{id}/cancelar`',
    nombre: 'POST /citas/{id}/cancelar (cita del cliente)',
    exito: 200,
    ejecutar: async (p, s, _r, t) => {
      const citaId = await citaDelCliente(s, 5, '12:00');
      return p.agente.post(`/api/v1/citas/${citaId}/cancelar`).set(con(t));
    },
  },
  {
    fila: '`POST /citas/{id}/estado`',
    nombre: 'POST /citas/{id}/estado (cita pasada del barbero vinculado)',
    exito: 200,
    ejecutar: async (p, s, _r, t) => {
      const citaId = await citaDelCliente(s, -1, '12:00');
      return p.agente.post(`/api/v1/citas/${citaId}/estado`).set(con(t)).send({ estado: 'COMPLETADA' });
    },
  },
  {
    fila: '`GET /agenda`',
    nombre: 'GET /agenda',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get(`/api/v1/agenda?fecha=${fecha}`).set(con(t)),
  },
  {
    fila: '`GET /clientes`, `POST /clientes` (presencial)',
    nombre: 'GET /clientes',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/clientes?buscar=cliente').set(con(t)),
  },
  {
    fila: '`GET /clientes`, `POST /clientes` (presencial)',
    nombre: 'POST /clientes',
    exito: 201,
    ejecutar: (p, _s, _r, t) =>
      p.agente.post('/api/v1/clientes').set(con(t)).send({
        nombre: 'Cliente Presencial',
        telefono: '966333444',
        consentimientoVerbal: true,
        versionPoliticaDatos: '2026-10',
      }),
  },
  {
    fila: '`GET /clientes/yo/citas`',
    nombre: 'GET /clientes/yo/citas',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/clientes/yo/citas').set(con(t)),
  },
  {
    fila: '`GET /usuarios`, `POST /usuarios`, … (001)',
    nombre: 'GET /usuarios',
    exito: 200,
    ejecutar: (p, _s, _r, t) => p.agente.get('/api/v1/usuarios').set(con(t)),
  },
];

const MATRIZ = leerMatriz();

/** Estado esperado según el símbolo de la celda. */
function esperado(simbolo: string, exito: number): number {
  if (simbolo === '✓' || simbolo === '✓*') return exito;
  if (simbolo === '—') return 403;
  if (simbolo === '401') return 401;
  throw new Error(`Símbolo desconocido en rbac.md: "${simbolo}"`);
}

describe('PR08 · Matriz rol × operación de 002 (contracts/rbac.md)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('cada fila de la tabla tiene al menos un caso y cada caso apunta a una fila existente', () => {
    expect(MATRIZ.size).toBeGreaterThanOrEqual(20);
    const cubiertas = new Set(CASOS.map((c) => c.fila));
    expect([...MATRIZ.keys()].filter((fila) => !cubiertas.has(fila))).toEqual([]);
    expect([...cubiertas].filter((fila) => !MATRIZ.has(fila))).toEqual([]);
  });

  const casos = CASOS.flatMap((caso) => ROLES.map((rol) => [caso.nombre, rol, caso] as const));

  it.each(casos)('%s · %s', async (_nombre, rol, caso) => {
    const simbolo = (MATRIZ.get(caso.fila) as Record<Rol, string>)[rol];
    const estado = esperado(simbolo, caso.exito);
    const s = await crearEscenario();
    const token = rol === 'PUB' ? null : s.tokens[rol];
    const denegacionesAntes = (await filasDe('audit_log', s.e.barberia.tenantId)).filter(
      (f) => f.action === 'ACCESO_DENEGADO_ROL',
    ).length;

    const respuesta = await caso.ejecutar(prueba, s, rol, token);
    expect({ celda: simbolo, estado: respuesta.status }).toEqual({ celda: simbolo, estado });

    const denegaciones = (await filasDe('audit_log', s.e.barberia.tenantId)).filter(
      (f) => f.action === 'ACCESO_DENEGADO_ROL',
    );
    if (estado === 403) {
      // Cada — deja exactamente un registro con quien lo intentó como actor.
      expect(denegaciones).toHaveLength(denegacionesAntes + 1);
      expect(denegaciones.at(-1)).toMatchObject({
        actor_id: s.actores[rol as Exclude<Rol, 'PUB'>],
        result: 'DENEGADO',
      });
    } else {
      expect(denegaciones).toHaveLength(denegacionesAntes);
    }
  });
});
