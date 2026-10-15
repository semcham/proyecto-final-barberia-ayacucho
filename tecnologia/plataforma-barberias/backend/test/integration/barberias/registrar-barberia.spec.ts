import { randomBytes } from 'node:crypto';
import { SuscripcionesApi } from '../../../src/modules/suscripciones-pagos';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T058 · Registro de una barbería de punta a punta, contra PostgreSQL real con RLS.

const RUTA = '/api/v1/barberias';
const DIA_MS = 24 * 60 * 60 * 1000;

const correoNuevo = (prefijo = 'dueno') => `${prefijo}-${randomBytes(4).toString('hex')}@prueba.pe`;

function registro(correo: string, nombreBarberia = 'Barbería Huamanga') {
  return {
    nombreBarberia,
    propietario: { nombre: 'Rosa Quispe', correo, contrasena: 'mi barberia en huamanga' },
    aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
  };
}

async function contarFilas(): Promise<Record<string, number>> {
  const seed = poolDe('seed');
  const tablas = [
    'tenant',
    'user_account',
    'membership',
    'terms_acceptance',
    'subscription',
    'audit_log',
    'auth_session',
  ];
  const conteos: Record<string, number> = {};
  for (const tabla of tablas) {
    const { rows } = await seed.query<{ total: number }>(`SELECT count(*)::int AS total FROM ${tabla}`);
    conteos[tabla] = rows[0].total;
  }
  return conteos;
}

describe('RegistrarBarberia (integración)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('crea barbería, propietario, membresía, aceptaciones, prueba gratuita, auditoría y sesión con el mismo tenant', async () => {
    const correo = correoNuevo();
    const antes = Date.now();
    const respuesta = await prueba.agente.post(RUTA).send(registro(correo)).expect(201);
    const tenantId: string = respuesta.body.barberia.id;
    const seed = poolDe('seed');

    const tenant = await seed.query('SELECT name, slug, status FROM tenant WHERE id = $1', [tenantId]);
    expect(tenant.rows[0]).toMatchObject({ name: 'Barbería Huamanga', status: 'ACTIVA' });
    expect(tenant.rows[0].slug).toMatch(/^barberia-huamanga(-[a-z0-9]+)?$/);

    const cuenta = await seed.query('SELECT id, email, password_hash FROM user_account WHERE email = $1', [
      correo,
    ]);
    expect(cuenta.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    const usuarioId: string = cuenta.rows[0].id;

    expect(await filasDe('membership', tenantId)).toEqual([
      expect.objectContaining({ user_id: usuarioId, role_code: 'PROPIETARIO', status: 'ACTIVA' }),
    ]);
    const aceptaciones = await filasDe('terms_acceptance', tenantId);
    expect(aceptaciones.map((fila) => [fila.document, fila.text_version]).sort()).toEqual([
      ['POLITICA_DATOS', '2026-10'],
      ['TERMINOS', '2026-10'],
    ]);

    const [suscripcion] = await filasDe('subscription', tenantId);
    expect(suscripcion.status).toBe('TRIAL');
    const inicio = (suscripcion.started_at as Date).getTime();
    expect(inicio).toBeGreaterThanOrEqual(antes - 1000);
    expect((suscripcion.trial_ends_at as Date).getTime() - inicio).toBe(14 * DIA_MS);

    expect(await filasDe('audit_log', tenantId)).toEqual([
      expect.objectContaining({ action: 'BARBERIA_REGISTRADA', actor_id: usuarioId, result: 'PERMITIDO' }),
    ]);
    expect(await filasDe('auth_session', tenantId)).toEqual([
      expect.objectContaining({ user_id: usuarioId, status: 'ACTIVA' }),
    ]);
  });

  it('normaliza el correo (mayúsculas y espacios) y lo trata como la misma cuenta', async () => {
    const correo = correoNuevo('normaliza');
    await prueba.agente
      .post(RUTA)
      .send(registro(`  ${correo.toUpperCase()} `))
      .expect(201);
    const { rows } = await poolDe('seed').query('SELECT email FROM user_account WHERE email = $1', [correo]);
    expect(rows).toHaveLength(1);
    await prueba.agente.post(RUTA).send(registro(correo)).expect(409);
  });

  it('dos barberías con el mismo nombre obtienen slugs distintos', async () => {
    const nombre = `Barbería Gemela ${randomBytes(2).toString('hex')}`;
    const primera = await prueba.agente.post(RUTA).send(registro(correoNuevo(), nombre)).expect(201);
    const segunda = await prueba.agente.post(RUTA).send(registro(correoNuevo(), nombre)).expect(201);
    expect(primera.body.barberia.slug).not.toBe(segunda.body.barberia.slug);
    expect(primera.body.barberia.id).not.toBe(segunda.body.barberia.id);
  });

  it('dos registros simultáneos con el mismo correo: uno 201 y otro 409', async () => {
    const correo = correoNuevo('simultaneo');
    const estados = (
      await Promise.all([
        prueba.agente.post(RUTA).send(registro(correo)),
        prueba.agente.post(RUTA).send(registro(correo)),
      ])
    )
      .map((respuesta) => respuesta.status)
      .sort();
    expect(estados).toEqual([201, 409]);
  });

  it('rechaza versiones de términos distintas de las vigentes sin crear nada', async () => {
    const antes = await contarFilas();
    const cuerpo = registro(correoNuevo());
    cuerpo.aceptaciones.terminosVersion = '2020-01';
    const respuesta = await prueba.agente.post(RUTA).send(cuerpo).expect(400);
    expect(respuesta.body.codigo).toBe('VALIDACION');
    expect(await contarFilas()).toEqual(antes);
  });
});

describe('RegistrarBarberia: un fallo a mitad no deja nada (FR-002, SC-002)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp({
      ajustar: (constructor) =>
        constructor.overrideProvider(SuscripcionesApi).useValue({
          iniciarPruebaGratuita: async () => {
            throw new Error('falla simulada al iniciar la prueba gratuita');
          },
          obtenerLimiteUsuarios: async () => 5,
          bloquearYObtenerLimiteUsuarios: async () => 5,
        }),
    });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('responde 500 y no crea filas en ninguna tabla', async () => {
    const antes = await contarFilas();
    const correo = correoNuevo('fallo');
    const respuesta = await prueba.agente.post(RUTA).send(registro(correo)).expect(500);
    expect(respuesta.body).toEqual({
      codigo: 'ERROR_INTERNO',
      mensaje: expect.any(String),
      detalles: [],
    });
    expect(JSON.stringify(respuesta.body)).not.toContain('falla simulada');
    expect(await contarFilas()).toEqual(antes);
  });
});
