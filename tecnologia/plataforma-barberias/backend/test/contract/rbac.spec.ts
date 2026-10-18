import { randomBytes } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { filasDe, sembrarBarbero, sembrarCita, sembrarCliente, sembrarServicio } from '../helpers/fixtures';
import { cerrarPools } from '../helpers/test-db';
import { crearEscenario, type Escenario } from '../helpers/sesiones';

// T099 · PR08: cada celda de contracts/rbac.md (PUB, PROPIETARIO, BARBERO × operación) es un caso.
// Cada caso usa un escenario nuevo para que no dependa de los anteriores (p. ej. un cierre de sesión).

type Rol = 'PUB' | 'PROPIETARIO' | 'BARBERO';

interface Operacion {
  nombre: string;
  esperado: Record<Rol, number>;
  ejecutar: (prueba: AppDePrueba, escenario: Escenario, token: string | null) => Promise<{ status: number }>;
}

const correoNuevo = () => `rbac-${randomBytes(4).toString('hex')}@prueba.pe`;
const conToken = (token: string | null) => (token ? { Authorization: `Bearer ${token}` } : {});

// Operaciones protegidas: sin sesión 401; el rol decide entre 2xx y 403.
const PROTEGIDAS: Operacion[] = [
  {
    nombre: 'POST /auth/logout',
    esperado: { PUB: 401, PROPIETARIO: 204, BARBERO: 204 },
    ejecutar: (p, _e, t) => p.agente.post('/api/v1/auth/logout').set(conToken(t)),
  },
  {
    nombre: 'GET /auth/yo',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 200 },
    ejecutar: (p, _e, t) => p.agente.get('/api/v1/auth/yo').set(conToken(t)),
  },
  {
    nombre: 'GET /usuarios',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 403 },
    ejecutar: (p, _e, t) => p.agente.get('/api/v1/usuarios').set(conToken(t)),
  },
  {
    nombre: 'GET /usuarios/{id}',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 403 },
    ejecutar: (p, e, t) => p.agente.get(`/api/v1/usuarios/${e.barberoActivo.id}`).set(conToken(t)),
  },
  {
    nombre: 'POST /usuarios',
    esperado: { PUB: 401, PROPIETARIO: 201, BARBERO: 403 },
    ejecutar: (p, _e, t) =>
      p.agente
        .post('/api/v1/usuarios')
        .set(conToken(t))
        .send({ nombre: 'Nuevo Barbero', correo: correoNuevo(), rol: 'BARBERO' }),
  },
  {
    nombre: 'PATCH /usuarios/{id}',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 403 },
    ejecutar: (p, e, t) =>
      p.agente
        .patch(`/api/v1/usuarios/${e.barberoPendiente.id}`)
        .set(conToken(t))
        .send({ estado: 'DESACTIVADA' }),
  },
  {
    nombre: 'POST /usuarios/{id}/activacion',
    esperado: { PUB: 401, PROPIETARIO: 201, BARBERO: 403 },
    ejecutar: (p, e, t) =>
      p.agente.post(`/api/v1/usuarios/${e.barberoPendiente.id}/activacion`).set(conToken(t)),
  },
  // Funcionalidad 002 · US4 (T102, contracts/rbac.md de 002). El barbero del escenario se vincula a un
  // barbero del catálogo: su alcance es PROPIOS (nota 8 y 9).
  {
    nombre: 'GET /agenda',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 200 },
    ejecutar: async (p, e, t) => {
      await barberoVinculado(e);
      return p.agente.get('/api/v1/agenda?fecha=2026-10-20').set(conToken(t));
    },
  },
  {
    nombre: 'POST /citas/{id}/estado',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 200 },
    ejecutar: async (p, e, t) => {
      const { barberoId, servicioId } = await barberoVinculado(e);
      const { clienteId } = await sembrarCliente({ tenantId: e.barberia.tenantId, conCuenta: false });
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId,
        servicioId,
        clienteId,
        inicio: new Date(Date.now() - 2 * 60 * 60 * 1000),
      });
      return p.agente.post(`/api/v1/citas/${citaId}/estado`).set(conToken(t)).send({ estado: 'COMPLETADA' });
    },
  },
  {
    // US5 (T114): el barbero no cancela (nota 6 y 7: el propietario cualquiera, nunca tardía).
    nombre: 'POST /citas/{id}/cancelar',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 403 },
    ejecutar: async (p, e, t) => {
      const { barberoId, servicioId } = await barberoVinculado(e);
      const { clienteId } = await sembrarCliente({ tenantId: e.barberia.tenantId, conCuenta: false });
      const citaId = await sembrarCita({
        tenantId: e.barberia.tenantId,
        barberoId,
        servicioId,
        clienteId,
        inicio: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      return p.agente.post(`/api/v1/citas/${citaId}/cancelar`).set(conToken(t));
    },
  },
  {
    // US6 (T120): el historial es solo del cliente; el personal recibe 403.
    nombre: 'GET /clientes/yo/citas',
    esperado: { PUB: 401, PROPIETARIO: 403, BARBERO: 403 },
    ejecutar: (p, _e, t) => p.agente.get('/api/v1/clientes/yo/citas').set(conToken(t)),
  },
  {
    nombre: 'GET /clientes',
    esperado: { PUB: 401, PROPIETARIO: 200, BARBERO: 403 },
    ejecutar: (p, _e, t) => p.agente.get('/api/v1/clientes?buscar=ana').set(conToken(t)),
  },
  {
    nombre: 'POST /clientes',
    esperado: { PUB: 401, PROPIETARIO: 201, BARBERO: 403 },
    ejecutar: (p, _e, t) =>
      p.agente.post('/api/v1/clientes').set(conToken(t)).send({
        nombre: 'Cliente Presencial',
        telefono: '966111222',
        consentimientoVerbal: true,
        versionPoliticaDatos: '2026-10',
      }),
  },
];

/** Servicio y barbero del catálogo vinculado al barbero activo del escenario (US4 de 002). */
async function barberoVinculado(e: Escenario) {
  const { servicioId } = await sembrarServicio({ tenantId: e.barberia.tenantId });
  const { barberoId } = await sembrarBarbero({
    tenantId: e.barberia.tenantId,
    usuarioId: e.barberoActivo.id,
    servicios: [servicioId],
  });
  return { barberoId, servicioId };
}

// Operaciones públicas: funcionan sin sesión y un token de cualquier rol no las bloquea.
const PUBLICAS: Operacion[] = [
  {
    nombre: 'POST /barberias',
    esperado: { PUB: 201, PROPIETARIO: 201, BARBERO: 201 },
    ejecutar: (p, _e, t) =>
      p.agente
        .post('/api/v1/barberias')
        .set(conToken(t))
        .send({
          nombreBarberia: 'Barbería RBAC',
          propietario: {
            nombre: 'Dueño Nuevo',
            correo: correoNuevo(),
            contrasena: 'una clave larga y propia',
          },
          aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
        }),
  },
  {
    nombre: 'POST /auth/login',
    esperado: { PUB: 200, PROPIETARIO: 200, BARBERO: 200 },
    ejecutar: (p, e, t) =>
      p.agente
        .post('/api/v1/auth/login')
        .set(conToken(t))
        .send({ correo: e.barberoActivo.correo, contrasena: e.barberoActivo.contrasena }),
  },
  {
    nombre: 'POST /auth/activar',
    esperado: { PUB: 204, PROPIETARIO: 204, BARBERO: 204 },
    ejecutar: async (p, e, t) => {
      const creado = await p.agente
        .post('/api/v1/usuarios')
        .set(conToken(e.tokenPropietario))
        .send({ nombre: 'Por Activar', correo: correoNuevo(), rol: 'BARBERO' });
      const token = new URL(creado.body.activacion.enlace).searchParams.get('token');
      return p.agente
        .post('/api/v1/auth/activar')
        .set(conToken(t))
        .send({ token, contrasena: 'una clave larga y propia' });
    },
  },
];

describe('PR08 · Matriz rol × operación (contracts/rbac.md)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const casos = [...PROTEGIDAS, ...PUBLICAS].flatMap((operacion) =>
    (['PUB', 'PROPIETARIO', 'BARBERO'] as Rol[]).map((rol) => [operacion.nombre, rol, operacion] as const),
  );

  it.each(casos)('%s · %s', async (_nombre, rol, operacion) => {
    const escenario = await crearEscenario();
    const token =
      rol === 'PUB' ? null : rol === 'PROPIETARIO' ? escenario.tokenPropietario : escenario.tokenBarbero;
    const auditoriaAntes = (await filasDe('audit_log', escenario.barberia.tenantId)).filter(
      (fila) => fila.action === 'ACCESO_DENEGADO_ROL',
    ).length;

    const respuesta = await operacion.ejecutar(prueba, escenario, token);
    expect(respuesta.status).toBe(operacion.esperado[rol]);

    const denegaciones = (await filasDe('audit_log', escenario.barberia.tenantId)).filter(
      (fila) => fila.action === 'ACCESO_DENEGADO_ROL',
    );
    if (operacion.esperado[rol] === 403) {
      // Cada 403 deja exactamente un registro con quien lo intentó como actor.
      expect(denegaciones).toHaveLength(auditoriaAntes + 1);
      const actor = rol === 'PROPIETARIO' ? escenario.barberia.propietarioId : escenario.barberoActivo.id;
      expect(denegaciones.at(-1)).toMatchObject({ actor_id: actor, result: 'DENEGADO' });
    } else {
      expect(denegaciones).toHaveLength(auditoriaAntes);
    }
  });

  it('refresh: sin cookie 401, con la cookie de un inicio de sesión 200', async () => {
    const escenario = await crearEscenario();
    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', '').expect(401);
    const inicio = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: escenario.barberoActivo.correo, contrasena: escenario.barberoActivo.contrasena })
      .expect(200);
    const cookie = ([] as string[])
      .concat(inicio.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('rt='));
    await prueba.agente
      .post('/api/v1/auth/refresh')
      .set('Cookie', (cookie as string).split(';')[0])
      .expect(200);
  });
});
