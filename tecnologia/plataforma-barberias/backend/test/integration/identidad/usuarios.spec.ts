import { createHash, randomBytes } from 'node:crypto';
import { UsuarioRepository } from '../../../src/modules/acceso-barberias/identidad/application/ports/usuario-repository';
import { KyselyUsuarioRepository } from '../../../src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { filasDe, sembrarUsuario } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { crearEscenario, type Escenario } from '../../helpers/sesiones';

// T100 · Gestión de usuarios del personal (RF06, HU04) contra PostgreSQL real.

/**
 * Repositorio que espera entre contar el personal vigente y seguir con el alta. Hace que dos altas
 * simultáneas se solapen siempre en la ventana crítica (contar → insertar), donde estaba la carrera.
 */
class UsuarioRepositoryLento extends KyselyUsuarioRepository {
  override async contarPersonalVigente(): Promise<number> {
    const vigentes = await super.contarPersonalVigente();
    await new Promise((resolver) => setTimeout(resolver, 300));
    return vigentes;
  }
}

describe('Límite del plan con altas simultáneas (FR-020)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp({
      ajustar: (constructor) =>
        constructor.overrideProvider(UsuarioRepository).useClass(UsuarioRepositoryLento),
    });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('con un solo cupo libre, dos altas simultáneas dan una 201 y otra 403; nunca se supera el plan', async () => {
    const e = await crearEscenario();
    const alta = () =>
      prueba.agente
        .post('/api/v1/usuarios')
        .set({ Authorization: `Bearer ${e.tokenPropietario}` })
        .send({ nombre: 'Barbero Simultáneo', correo: correoNuevo('simultaneo'), rol: 'BARBERO' });

    // 3 vigentes + 1 = 4 de 5: queda exactamente un cupo.
    await alta().expect(201);
    const estados = (await Promise.all([alta(), alta()])).map((respuesta) => respuesta.status).sort();
    expect(estados).toEqual([201, 403]);

    const { rows } = await poolDe('seed').query<{ vigentes: number }>(
      `SELECT count(*)::int AS vigentes FROM membership WHERE tenant_id = $1 AND status IN ('PENDIENTE', 'ACTIVA')`,
      [e.barberia.tenantId],
    );
    expect(rows[0].vigentes).toBe(5);
  });

  it('con un solo cupo libre, una reactivación y un alta simultáneas: solo una se aplica y la otra da 403', async () => {
    const e = await crearEscenario();
    const desactivado = await sembrarUsuario({
      tenantId: e.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'DESACTIVADA',
    });
    const conPropietario = { Authorization: `Bearer ${e.tokenPropietario}` };
    // 3 vigentes (el desactivado no ocupa cupo) + 1 = 4 de 5: queda exactamente un cupo.
    await prueba.agente
      .post('/api/v1/usuarios')
      .set(conPropietario)
      .send({ nombre: 'Barbero Previo', correo: correoNuevo('previo'), rol: 'BARBERO' })
      .expect(201);

    const [reactivacion, alta] = await Promise.all([
      prueba.agente
        .patch(`/api/v1/usuarios/${desactivado.usuarioId}`)
        .set(conPropietario)
        .send({ estado: 'ACTIVA' }),
      prueba.agente
        .post('/api/v1/usuarios')
        .set(conPropietario)
        .send({ nombre: 'Barbero Simultáneo', correo: correoNuevo('simultaneo'), rol: 'BARBERO' }),
    ]);
    const exitos = [reactivacion.status === 200, alta.status === 201].filter(Boolean).length;
    expect(exitos).toBe(1);
    expect([reactivacion.status, alta.status]).toContain(403);

    const { rows } = await poolDe('seed').query<{ vigentes: number }>(
      `SELECT count(*)::int AS vigentes FROM membership WHERE tenant_id = $1 AND status IN ('PENDIENTE', 'ACTIVA')`,
      [e.barberia.tenantId],
    );
    expect(rows[0].vigentes).toBe(5);
  });
});

const correoNuevo = (prefijo = 'barbero') => `${prefijo}-${randomBytes(4).toString('hex')}@prueba.pe`;
const tokenDelEnlace = (enlace: string) => new URL(enlace).searchParams.get('token') as string;
const CLAVE = 'una clave larga y propia';

describe('Usuarios del personal (integración)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const comoPropietario = (e: Escenario) => ({ Authorization: `Bearer ${e.tokenPropietario}` });

  function crearBarbero(e: Escenario, correo = correoNuevo()) {
    return prueba.agente
      .post('/api/v1/usuarios')
      .set(comoPropietario(e))
      .send({ nombre: 'Luis Barbero', correo, rol: 'BARBERO' });
  }

  it.each(['PROPIETARIO', 'CLIENTE', 'ADMIN_PLATAFORMA', 'ADMINISTRATIVO', 'INVENTADO'])(
    'crear con rol %s → 400 sin crear nada',
    async (rol) => {
      const e = await crearEscenario();
      const antes = await filasDe('membership', e.barberia.tenantId);
      await prueba.agente
        .post('/api/v1/usuarios')
        .set(comoPropietario(e))
        .send({ nombre: 'No Permitido', correo: correoNuevo(), rol })
        .expect(400);
      expect(await filasDe('membership', e.barberia.tenantId)).toEqual(antes);
    },
  );

  it('crear barbero → PENDIENTE con enlace; activar → 204; el barbero inicia sesión con rol BARBERO', async () => {
    const e = await crearEscenario();
    const correo = correoNuevo('activa');
    const creado = await crearBarbero(e, correo).expect(201);
    expect(creado.body.usuario).toMatchObject({ correo, rol: 'BARBERO', estado: 'PENDIENTE' });

    // Solo se guarda el hash del token, nunca el token.
    const token = tokenDelEnlace(creado.body.activacion.enlace);
    const activaciones = await filasDe('account_activation', e.barberia.tenantId);
    expect(activaciones.map((fila) => fila.token_hash)).toContain(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(JSON.stringify(activaciones)).not.toContain(token);

    await prueba.agente.post('/api/v1/auth/activar').send({ token, contrasena: CLAVE }).expect(204);

    const inicio = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo, contrasena: CLAVE })
      .expect(200);
    expect(inicio.body.usuario).toMatchObject({ rol: 'BARBERO' });
    expect(inicio.body.usuario.barberia.id).toBe(e.barberia.tenantId);
  });

  it('el enlace no sirve dos veces, vencido ni revocado (mismo 400 ENLACE_INVALIDO)', async () => {
    const e = await crearEscenario();
    const creado = await crearBarbero(e).expect(201);
    const token = tokenDelEnlace(creado.body.activacion.enlace);
    await prueba.agente.post('/api/v1/auth/activar').send({ token, contrasena: CLAVE }).expect(204);
    const reutilizado = await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: CLAVE })
      .expect(400);
    expect(reutilizado.body.codigo).toBe('ENLACE_INVALIDO');

    const vencido = await crearBarbero(e).expect(201);
    const tokenVencido = tokenDelEnlace(vencido.body.activacion.enlace);
    await poolDe('seed').query(
      "UPDATE account_activation SET expires_at = now() - interval '1 minute' WHERE token_hash = $1",
      [createHash('sha256').update(tokenVencido).digest('hex')],
    );
    const respuestaVencido = await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token: tokenVencido, contrasena: CLAVE })
      .expect(400);
    expect(respuestaVencido.body).toEqual(reutilizado.body);

    const inexistente = await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token: randomBytes(32).toString('base64url'), contrasena: CLAVE })
      .expect(400);
    expect(inexistente.body).toEqual(reutilizado.body);
  });

  it('regenerar el enlace invalida el anterior y queda auditado', async () => {
    const e = await crearEscenario();
    const creado = await crearBarbero(e).expect(201);
    const anterior = tokenDelEnlace(creado.body.activacion.enlace);
    const nuevo = await prueba.agente
      .post(`/api/v1/usuarios/${creado.body.usuario.id}/activacion`)
      .set(comoPropietario(e))
      .expect(201);
    await prueba.agente.post('/api/v1/auth/activar').send({ token: anterior, contrasena: CLAVE }).expect(400);
    await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token: tokenDelEnlace(nuevo.body.enlace), contrasena: CLAVE })
      .expect(204);
    expect(await filasDe('audit_log', e.barberia.tenantId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'ACTIVACION_REGENERADA', actor_id: e.barberia.propietarioId }),
      ]),
    );
  });

  it('una contraseña débil al activar → 400 VALIDACION y el enlace sigue sirviendo', async () => {
    const e = await crearEscenario();
    const correo = correoNuevo('debil');
    const creado = await crearBarbero(e, correo).expect(201);
    const token = tokenDelEnlace(creado.body.activacion.enlace);
    const debil = await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token, contrasena: `${correo.split('@')[0]}-2026` })
      .expect(400);
    expect(debil.body.codigo).toBe('VALIDACION');
    await prueba.agente.post('/api/v1/auth/activar').send({ token, contrasena: CLAVE }).expect(204);
  });

  it('correo existente (de otra barbería) → 409 sin revelar la barbería', async () => {
    const e = await crearEscenario();
    const otra = await crearEscenario('Barbería Ajena Secreta');
    const respuesta = await crearBarbero(e, otra.barberoActivo.correo).expect(409);
    expect(respuesta.body.codigo).toBe('CORREO_NO_DISPONIBLE');
    expect(JSON.stringify(respuesta.body)).not.toContain('Secreta');
  });

  it('superar max_users del plan → 403 SUSCRIPCION_NO_PERMITE; un desactivado libera cupo', async () => {
    const e = await crearEscenario();
    // Ya hay 3 vigentes (propietario, activo, pendiente); el plan TRIAL permite 5.
    await crearBarbero(e).expect(201);
    await crearBarbero(e).expect(201);
    const excedido = await crearBarbero(e).expect(403);
    expect(excedido.body).toMatchObject({
      codigo: 'SUSCRIPCION_NO_PERMITE',
      detalles: [{ motivo: 'LIMITE_USUARIOS', maximo: 5 }],
    });

    await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberoPendiente.id}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    await crearBarbero(e).expect(201);
  });

  it('reactivar respeta el límite del plan: 403 con el plan lleno, 200 al liberar un cupo (FR-020)', async () => {
    const e = await crearEscenario();
    const desactivado = await sembrarUsuario({
      tenantId: e.barberia.tenantId,
      rol: 'BARBERO',
      estado: 'DESACTIVADA',
    });
    // 3 vigentes + 2 altas = 5 de 5: plan lleno.
    await crearBarbero(e).expect(201);
    await crearBarbero(e).expect(201);

    const lleno = await prueba.agente
      .patch(`/api/v1/usuarios/${desactivado.usuarioId}`)
      .set(comoPropietario(e))
      .send({ estado: 'ACTIVA' })
      .expect(403);
    expect(lleno.body).toMatchObject({
      codigo: 'SUSCRIPCION_NO_PERMITE',
      detalles: [{ motivo: 'LIMITE_USUARIOS', maximo: 5 }],
    });
    const sigue = await prueba.agente
      .get(`/api/v1/usuarios/${desactivado.usuarioId}`)
      .set(comoPropietario(e))
      .expect(200);
    expect(sigue.body.estado).toBe('DESACTIVADA');

    // Reactivar a alguien que ya está activo sigue siendo 422, no un 403 de límite.
    await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberoActivo.id}`)
      .set(comoPropietario(e))
      .send({ estado: 'ACTIVA' })
      .expect(422);

    // Al desactivar a otro se libera un cupo y la reactivación ya entra.
    await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberoActivo.id}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    const reactivado = await prueba.agente
      .patch(`/api/v1/usuarios/${desactivado.usuarioId}`)
      .set(comoPropietario(e))
      .send({ estado: 'ACTIVA' })
      .expect(200);
    expect(['ACTIVA', 'PENDIENTE']).toContain(reactivado.body.estado);
  });

  it('desactivar revoca sus sesiones (siguiente solicitud 401, login 403) y conserva sus datos', async () => {
    const e = await crearEscenario();
    await prueba.agente
      .get('/api/v1/auth/yo')
      .set({ Authorization: `Bearer ${e.tokenBarbero}` })
      .expect(200);

    const respuesta = await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberoActivo.id}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    expect(respuesta.body.estado).toBe('DESACTIVADA');

    await prueba.agente
      .get('/api/v1/auth/yo')
      .set({ Authorization: `Bearer ${e.tokenBarbero}` })
      .expect(401);
    const login = await prueba.agente
      .post('/api/v1/auth/login')
      .send({ correo: e.barberoActivo.correo, contrasena: e.barberoActivo.contrasena })
      .expect(403);
    expect(login.body.codigo).toBe('ACCESO_SUSPENDIDO');

    const sesiones = (await filasDe('auth_session', e.barberia.tenantId)).filter(
      (fila) => fila.user_id === e.barberoActivo.id,
    );
    expect(sesiones.length).toBeGreaterThan(0);
    expect(sesiones.every((fila) => fila.status === 'REVOCADA')).toBe(true);
    const cuenta = await poolDe('seed').query('SELECT id FROM user_account WHERE id = $1', [
      e.barberoActivo.id,
    ]);
    expect(cuenta.rows).toHaveLength(1);
  });

  it('reactivar: ACTIVA si ya activó su cuenta, PENDIENTE si nunca fijó contraseña', async () => {
    const e = await crearEscenario();
    const creado = await crearBarbero(e).expect(201);
    const id = creado.body.usuario.id as string;
    await prueba.agente
      .post('/api/v1/auth/activar')
      .send({ token: tokenDelEnlace(creado.body.activacion.enlace), contrasena: CLAVE })
      .expect(204);
    await prueba.agente
      .patch(`/api/v1/usuarios/${id}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    const conClave = await prueba.agente
      .patch(`/api/v1/usuarios/${id}`)
      .set(comoPropietario(e))
      .send({ estado: 'ACTIVA' })
      .expect(200);
    expect(conClave.body.estado).toBe('ACTIVA');

    await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberoPendiente.id}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    const sinClave = await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberoPendiente.id}`)
      .set(comoPropietario(e))
      .send({ estado: 'ACTIVA' })
      .expect(200);
    expect(sinClave.body.estado).toBe('PENDIENTE');
  });

  it('el propietario no puede desactivarse a sí mismo (422)', async () => {
    const e = await crearEscenario();
    const respuesta = await prueba.agente
      .patch(`/api/v1/usuarios/${e.barberia.propietarioId}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(422);
    expect(respuesta.body.codigo).toBe('OPERACION_NO_PERMITIDA');
  });

  it('cada acción queda en audit_log de la barbería (PR13)', async () => {
    const e = await crearEscenario();
    const creado = await crearBarbero(e).expect(201);
    const id = creado.body.usuario.id as string;
    await prueba.agente
      .patch(`/api/v1/usuarios/${id}`)
      .set(comoPropietario(e))
      .send({ estado: 'DESACTIVADA' })
      .expect(200);
    await prueba.agente
      .patch(`/api/v1/usuarios/${id}`)
      .set(comoPropietario(e))
      .send({ estado: 'ACTIVA' })
      .expect(200);
    const acciones = (await filasDe('audit_log', e.barberia.tenantId))
      .filter((fila) => fila.resource === `usuario:${id}`)
      .map((fila) => fila.action);
    expect(acciones.sort()).toEqual(['USUARIO_CREADO', 'USUARIO_DESACTIVADO', 'USUARIO_REACTIVADO']);
  });

  it('listar filtra por estado y pagina', async () => {
    const e = await crearEscenario();
    await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'DESACTIVADA' });
    const pendientes = await prueba.agente
      .get('/api/v1/usuarios?estado=PENDIENTE')
      .set(comoPropietario(e))
      .expect(200);
    expect(pendientes.body.datos.map((u: { id: string }) => u.id)).toEqual([e.barberoPendiente.id]);
    const pagina = await prueba.agente
      .get('/api/v1/usuarios?pagina=2&tamano=2')
      .set(comoPropietario(e))
      .expect(200);
    expect(pagina.body).toMatchObject({ total: 4, pagina: 2, tamano: 2 });
    expect(pagina.body.datos).toHaveLength(2);
    const primera = await prueba.agente.get('/api/v1/usuarios?tamano=2').set(comoPropietario(e)).expect(200);
    expect(primera.body.datos[0].rol).toBe('PROPIETARIO');
  });
});
