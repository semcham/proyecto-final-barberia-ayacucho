import { randomBytes } from 'node:crypto';
import { CrearUsuario } from '../../src/modules/acceso-barberias/identidad/application/crear-usuario';
import { AccesoDenegado } from '../../src/modules/acceso-barberias';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { filasDe } from '../helpers/fixtures';
import { cerrarPools, poolDe } from '../helpers/test-db';
import { crearEscenario, type Escenario } from '../helpers/sesiones';

// T114 · PR13: cada acción sensible de FR-027 deja exactamente un registro completo en audit_log de su
// barbería, y la aplicación no puede modificarlo ni borrarlo (SC-007).

type Fila = Record<string, unknown>;
const correoNuevo = () => `auditoria-${randomBytes(4).toString('hex')}@prueba.pe`;
const CLAVE = 'una clave larga y propia';

describe('PR13 · Auditoría de acciones sensibles', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  /** Ejecuta la acción y devuelve las filas de audit_log nuevas de esa barbería. */
  async function registrosNuevos(tenantId: string, accion: () => Promise<unknown>): Promise<Fila[]> {
    const antes = new Set((await filasDe('audit_log', tenantId)).map((fila) => fila.id));
    await accion();
    return (await filasDe('audit_log', tenantId)).filter((fila) => !antes.has(fila.id));
  }

  function esCompleto(
    fila: Fila,
    esperado: { tenantId: string; actorId: string; accion: string; resultado: string },
  ) {
    expect(fila).toMatchObject({
      tenant_id: esperado.tenantId,
      actor_id: esperado.actorId,
      action: esperado.accion,
      result: esperado.resultado,
    });
    expect(typeof fila.resource).toBe('string');
    expect(fila.at).toBeInstanceOf(Date);
  }

  /** Los registros que nacen de una solicitud HTTP llevan la IP y el identificador de correlación. */
  function vieneDeLaSolicitud(fila: Fila, correlacion: string) {
    expect(fila.ip).toEqual(expect.any(String));
    expect(fila.correlation_id).toBe(correlacion);
  }

  const correlacion = () => `prueba-${randomBytes(6).toString('hex')}`;
  const conPropietario = (e: Escenario, id: string) => ({
    Authorization: `Bearer ${e.tokenPropietario}`,
    'X-Correlation-Id': id,
  });

  it('BARBERIA_REGISTRADA (actor: el propietario recién creado)', async () => {
    const id = correlacion();
    const respuesta = await prueba.agente
      .post('/api/v1/barberias')
      .set('X-Correlation-Id', id)
      .send({
        nombreBarberia: 'Barbería Auditada',
        propietario: { nombre: 'Dueña Auditada', correo: correoNuevo(), contrasena: CLAVE },
        aceptaciones: { terminosVersion: '2026-10', politicaDatosVersion: '2026-10' },
      })
      .expect(201);
    const filas = await filasDe('audit_log', respuesta.body.barberia.id);
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: respuesta.body.barberia.id,
      actorId: respuesta.body.sesion.usuario.id,
      accion: 'BARBERIA_REGISTRADA',
      resultado: 'PERMITIDO',
    });
    vieneDeLaSolicitud(filas[0], id);
  });

  it('USUARIO_CREADO, USUARIO_DESACTIVADO, USUARIO_REACTIVADO y ACTIVACION_REGENERADA', async () => {
    const e = await crearEscenario();
    const base = { tenantId: e.barberia.tenantId, actorId: e.barberia.propietarioId, resultado: 'PERMITIDO' };
    let nuevoId = '';

    const pasos: [string, () => Promise<unknown>, string][] = [
      [
        'USUARIO_CREADO',
        async () => {
          const r = await prueba.agente
            .post('/api/v1/usuarios')
            .set(conPropietario(e, 'correlacion-crear'))
            .send({ nombre: 'Barbero Auditado', correo: correoNuevo(), rol: 'BARBERO' })
            .expect(201);
          nuevoId = r.body.usuario.id;
        },
        'correlacion-crear',
      ],
      [
        'ACTIVACION_REGENERADA',
        () =>
          prueba.agente
            .post(`/api/v1/usuarios/${nuevoId}/activacion`)
            .set(conPropietario(e, 'correlacion-regen'))
            .expect(201),
        'correlacion-regen',
      ],
      [
        'USUARIO_DESACTIVADO',
        () =>
          prueba.agente
            .patch(`/api/v1/usuarios/${nuevoId}`)
            .set(conPropietario(e, 'correlacion-desact'))
            .send({ estado: 'DESACTIVADA' })
            .expect(200),
        'correlacion-desact',
      ],
      [
        'USUARIO_REACTIVADO',
        () =>
          prueba.agente
            .patch(`/api/v1/usuarios/${nuevoId}`)
            .set(conPropietario(e, 'correlacion-react'))
            .send({ estado: 'ACTIVA' })
            .expect(200),
        'correlacion-react',
      ],
    ];

    for (const [accion, ejecutar, idCorrelacion] of pasos) {
      const filas = await registrosNuevos(e.barberia.tenantId, ejecutar);
      expect(filas.map((fila) => fila.action)).toEqual([accion]);
      esCompleto(filas[0], { ...base, accion });
      expect(filas[0].resource).toBe(`usuario:${nuevoId}`);
      vieneDeLaSolicitud(filas[0], idCorrelacion);
    }
  });

  it('ACCESO_DENEGADO_ROL desde el guard HTTP', async () => {
    const e = await crearEscenario();
    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .get('/api/v1/usuarios')
        .set({ Authorization: `Bearer ${e.tokenBarbero}`, 'X-Correlation-Id': 'correlacion-guard' })
        .expect(403),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'ACCESO_DENEGADO_ROL',
      resultado: 'DENEGADO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-guard');
  });

  it('ACCESO_DENEGADO_ROL desde el caso de uso, sin pasar por HTTP (R22)', async () => {
    // Por HTTP el guard lo rechazaría antes; aquí se invoca el caso de uso como lo haría M04.
    const e = await crearEscenario();
    const crearUsuario = prueba.app.get(CrearUsuario, { strict: false });
    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      expect(
        crearUsuario.ejecutar(
          {
            usuarioId: e.barberoActivo.id,
            tenantId: e.barberia.tenantId,
            rol: 'BARBERO',
            sesionId: 'directo',
          },
          { nombre: 'No Debería', correo: correoNuevo(), rol: 'BARBERO' },
        ),
      ).rejects.toBeInstanceOf(AccesoDenegado),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'ACCESO_DENEGADO_ROL',
      resultado: 'DENEGADO',
    });
    expect(filas[0].resource).toBe('operacion:CREAR_USUARIO');
  });

  it('ACCESO_TENANT_AJENO ante un intento explícito', async () => {
    const e = await crearEscenario();
    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .get('/api/v1/auth/yo')
        .set({
          ...conPropietario(e, 'correlacion-ajeno'),
          'X-Tenant-Id': '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
        })
        .expect(400),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberia.propietarioId,
      accion: 'ACCESO_TENANT_AJENO',
      resultado: 'DENEGADO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-ajeno');
  });

  it('SESION_REUTILIZADA al usar un token de renovación ya rotado', async () => {
    const e = await crearEscenario();
    const inicio = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: e.barberoActivo.correo, contrasena: e.barberoActivo.contrasena })
      .expect(200);
    const cookie = ([] as string[])
      .concat(inicio.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('rt='))
      ?.split(';')[0] as string;
    await prueba.agente.post('/api/v1/auth/refresh').set('Cookie', cookie).expect(200);

    const filas = await registrosNuevos(e.barberia.tenantId, () =>
      prueba.agente
        .post('/api/v1/auth/refresh')
        .set({ Cookie: cookie, 'X-Correlation-Id': 'correlacion-reuso' })
        .expect(401),
    );
    expect(filas).toHaveLength(1);
    esCompleto(filas[0], {
      tenantId: e.barberia.tenantId,
      actorId: e.barberoActivo.id,
      accion: 'SESION_REUTILIZADA',
      resultado: 'DENEGADO',
    });
    vieneDeLaSolicitud(filas[0], 'correlacion-reuso');
  });

  it('barberias_app no puede modificar ni borrar registros de auditoría', async () => {
    const e = await crearEscenario();
    const cliente = await poolDe('app').connect();
    try {
      await cliente.query('BEGIN');
      await cliente.query("SELECT set_config('app.tenant_id', $1, true)", [e.barberia.tenantId]);
      await expect(cliente.query("UPDATE audit_log SET action = 'BORRADO'")).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await cliente.query('ROLLBACK');
      cliente.release();
    }
    await expect(poolDe('app').query('DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
  });
});
