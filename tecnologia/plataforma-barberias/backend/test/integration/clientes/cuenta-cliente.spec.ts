import { decodeJwt } from 'jose';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarCliente,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T078 · Cuenta de cliente (RF05; ADR-020; constitución 1.2.0, selección de membresía por enlace).

const REGISTRO = '/api/v1/clientes/registro';
const LOGIN = '/api/v1/auth/login';
const CAMBIO = '/api/v1/auth/barberia';
const VERSION = '2026-10';

function cookieRt(encabezados: Record<string, unknown>): string | undefined {
  return ([] as string[])
    .concat((encabezados['set-cookie'] as string[]) ?? [])
    .find((c) => c.startsWith('rt='));
}

const correoNuevo = (prefijo: string) =>
  `${prefijo}-${Date.now()}-${Math.round(Math.random() * 1e6)}@prueba.pe`;

describe('Cuenta de cliente', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  const registro = (cuerpo: Record<string, unknown>) =>
    prueba.agente.post(REGISTRO).send({
      barberia: a.slug,
      nombre: 'Rosa Quispe',
      correo: correoNuevo('rosa'),
      telefono: '966 123 456',
      contrasena: 'clave-de-rosa-segura',
      aceptaPoliticaDatos: true,
      versionPoliticaDatos: VERSION,
      ...cuerpo,
    });

  const filas = async (sql: string, parametros: unknown[]) =>
    (await poolDe('seed').query(sql, parametros)).rows;

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia({ nombre: 'Barbería A' });
    b = await sembrarBarberia({ nombre: 'Barbería B' });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  describe('registro desde el enlace (POST /clientes/registro)', () => {
    it('crea cuenta, membresía CLIENTE, perfil EN_LINEA y consentimiento, y abre la sesión en esa barbería', async () => {
      const correo = correoNuevo('ana');
      const respuesta = await registro({ correo, nombre: 'Ana Huamán' }).expect(201);
      expect(cookieRt(respuesta.headers)).toMatch(/HttpOnly/i);
      const usuario = respuesta.body.usuario;
      expect(usuario).toMatchObject({ nombre: 'Ana Huamán', correo, rol: 'CLIENTE' });
      expect(usuario.barberia).toEqual({ id: a.tenantId, nombre: 'Barbería A', slug: a.slug });
      expect(decodeJwt(respuesta.body.tokenAcceso)).toMatchObject({
        sub: usuario.id,
        tid: a.tenantId,
        rol: 'CLIENTE',
      });

      const [membresia] = await filas('SELECT role_code, status FROM membership WHERE user_id = $1', [
        usuario.id,
      ]);
      expect(membresia).toEqual({ role_code: 'CLIENTE', status: 'ACTIVA' });
      const [perfil] = await filas(
        'SELECT id, tenant_id, full_name, email, phone, origin FROM customer_profile WHERE user_id = $1',
        [usuario.id],
      );
      expect(perfil).toMatchObject({
        tenant_id: a.tenantId,
        full_name: 'Ana Huamán',
        email: correo,
        phone: '966 123 456',
        origin: 'EN_LINEA',
      });
      const [consentimiento] = await filas(
        'SELECT document, text_version, method, recorded_by, ip, accepted_at FROM consent_record WHERE customer_id = $1',
        [perfil.id],
      );
      expect(consentimiento).toMatchObject({
        document: 'POLITICA_DATOS',
        text_version: VERSION,
        method: 'EN_LINEA',
        recorded_by: null,
      });
      expect(consentimiento.ip).not.toBeNull();
      expect(consentimiento.accepted_at).toBeInstanceOf(Date);
      const auditoria = await filas('SELECT action FROM audit_log WHERE tenant_id = $1 AND actor_id = $2', [
        a.tenantId,
        usuario.id,
      ]);
      expect(auditoria.map((fila) => fila.action)).toContain('CLIENTE_REGISTRADO');
    });

    it('sin aceptar la política de datos → 400 y no se guarda nada', async () => {
      const correo = correoNuevo('sin-consentimiento');
      await registro({ correo, aceptaPoliticaDatos: false }).expect(400);
      await registro({ correo, aceptaPoliticaDatos: undefined }).expect(400);
      expect(await filas('SELECT id FROM user_account WHERE email = $1', [correo])).toEqual([]);
    });

    it('con una versión de la política que no es la vigente → 400', async () => {
      const correo = correoNuevo('version-vieja');
      await registro({ correo, versionPoliticaDatos: '2020-01' }).expect(400);
      expect(await filas('SELECT id FROM user_account WHERE email = $1', [correo])).toEqual([]);
    });

    it('con un correo que ya tiene cuenta → 409 CORREO_NO_DISPONIBLE sin revelar barberías', async () => {
      const existente = await sembrarCliente({ tenantId: b.tenantId });
      const { body } = await registro({ correo: existente.correo }).expect(409);
      expect(body.codigo).toBe('CORREO_NO_DISPONIBLE');
      expect(JSON.stringify(body)).not.toContain('Barbería B');
    });

    it('un enlace inexistente o de una barbería suspendida → 404 BARBERIA_NO_DISPONIBLE', async () => {
      const suspendida = await sembrarBarberia({ estado: 'SUSPENDIDA' });
      const r1 = await registro({ barberia: 'no-existe-esta' }).expect(404);
      const r2 = await registro({ barberia: suspendida.slug }).expect(404);
      expect(r1.body).toEqual(r2.body);
      expect(r1.body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
    });

    it('datos inválidos (teléfono, nombre, contraseña corta) → 400', async () => {
      await registro({ telefono: 'abc' }).expect(400);
      await registro({ nombre: 'X' }).expect(400);
      await registro({ contrasena: 'corta' }).expect(400);
    });
  });

  describe('inicio de sesión (POST /auth/login)', () => {
    it('sin enlace, una cuenta de cliente con la contraseña correcta → 409 INGRESA_DESDE_TU_BARBERIA', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const { body } = await prueba.agente
        .post(LOGIN)
        .send({ correo: cliente.correo, contrasena: cliente.contrasena })
        .expect(409);
      expect(body.codigo).toBe('INGRESA_DESDE_TU_BARBERIA');
    });

    it('sin enlace, con una contraseña incorrecta → el mismo 401 de 001 (no revela que es cliente)', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const { body } = await prueba.agente
        .post(LOGIN)
        .send({ correo: cliente.correo, contrasena: 'otra-clave-cualquiera' })
        .expect(401);
      expect(body).toEqual({
        codigo: 'CREDENCIALES_INVALIDAS',
        mensaje: 'Correo o contraseña incorrectos.',
        detalles: [],
      });
    });

    it('con el enlace de su barbería → sesión en esa barbería', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const { body } = await prueba.agente
        .post(LOGIN)
        .send({ correo: cliente.correo, contrasena: cliente.contrasena, barberia: a.slug })
        .expect(200);
      expect(decodeJwt(body.tokenAcceso)).toMatchObject({ tid: a.tenantId, rol: 'CLIENTE' });
      expect(body.usuario.barberia.slug).toBe(a.slug);
    });

    it('con el enlace de otra barbería: 409 UNIRSE_REQUIERE_CONSENTIMIENTO; con la aceptación se une sin otra cuenta', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const credenciales = { correo: cliente.correo, contrasena: cliente.contrasena, barberia: b.slug };
      const sinAceptar = await prueba.agente.post(LOGIN).send(credenciales).expect(409);
      expect(sinAceptar.body.codigo).toBe('UNIRSE_REQUIERE_CONSENTIMIENTO');
      // Aceptar sin teléfono no basta: el perfil de la barbería lo exige (HU06).
      await prueba.agente
        .post(LOGIN)
        .send({ ...credenciales, aceptaPoliticaDatos: true, versionPoliticaDatos: VERSION })
        .expect(400);

      const { body } = await prueba.agente
        .post(LOGIN)
        .send({
          ...credenciales,
          aceptaPoliticaDatos: true,
          versionPoliticaDatos: VERSION,
          telefono: '955 000 111',
        })
        .expect(200);
      expect(decodeJwt(body.tokenAcceso)).toMatchObject({
        sub: cliente.usuarioId,
        tid: b.tenantId,
        rol: 'CLIENTE',
      });

      expect(await filas('SELECT id FROM user_account WHERE email = $1', [cliente.correo])).toHaveLength(1);
      const perfiles = await filas(
        'SELECT tenant_id, phone FROM customer_profile WHERE user_id = $1 ORDER BY tenant_id',
        [cliente.usuarioId],
      );
      expect(perfiles.map((p) => p.tenant_id).sort()).toEqual([a.tenantId, b.tenantId].sort());
      const consentimientos = await filas(
        `SELECT c.tenant_id FROM consent_record c JOIN customer_profile p ON p.id = c.customer_id
         WHERE p.user_id = $1`,
        [cliente.usuarioId],
      );
      expect(consentimientos).toHaveLength(2);
      const auditoria = await filas('SELECT action FROM audit_log WHERE tenant_id = $1 AND actor_id = $2', [
        b.tenantId,
        cliente.usuarioId,
      ]);
      expect(auditoria.map((fila) => fila.action)).toContain('CLIENTE_UNIDO');
    });

    it('una cuenta del personal no puede unirse como cliente → 409 CUENTA_DE_PERSONAL', async () => {
      const barbero = await sembrarUsuario({ tenantId: a.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
      const { body } = await prueba.agente
        .post(LOGIN)
        .send({
          correo: barbero.correo,
          contrasena: barbero.contrasena,
          barberia: b.slug,
          aceptaPoliticaDatos: true,
          versionPoliticaDatos: VERSION,
          telefono: '955 000 222',
        })
        .expect(409);
      expect(body.codigo).toBe('CUENTA_DE_PERSONAL');
    });

    it('el personal sigue entrando sin enlace, como en 001', async () => {
      await prueba.agente.post(LOGIN).send({ correo: a.correo, contrasena: a.contrasena }).expect(200);
    });
  });

  describe('cambio de barbería (POST /auth/barberia)', () => {
    it('con membresía en B: token con el tid de B, cookie nueva y la sesión de A queda cerrada', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      await sembrarCliente({ tenantId: b.tenantId, usuarioId: cliente.usuarioId as string });
      const tokenA = await tokenPara(a.tenantId, cliente.usuarioId as string, 'CLIENTE');

      const respuesta = await prueba.agente
        .post(CAMBIO)
        .set({ Authorization: `Bearer ${tokenA}` })
        .send({ barberia: b.slug })
        .expect(200);
      expect(decodeJwt(respuesta.body.tokenAcceso)).toMatchObject({
        sub: cliente.usuarioId,
        tid: b.tenantId,
        rol: 'CLIENTE',
      });
      expect(respuesta.body.usuario.barberia.id).toBe(b.tenantId);
      expect(cookieRt(respuesta.headers)).toBeDefined();

      // El token anterior (sesión de A) ya no sirve.
      await prueba.agente
        .get('/api/v1/auth/yo')
        .set({ Authorization: `Bearer ${tokenA}` })
        .expect(401);
      await prueba.agente
        .get('/api/v1/auth/yo')
        .set({ Authorization: `Bearer ${respuesta.body.tokenAcceso}` })
        .expect(200);
      const auditoria = await filas('SELECT action FROM audit_log WHERE tenant_id = $1 AND actor_id = $2', [
        b.tenantId,
        cliente.usuarioId,
      ]);
      expect(auditoria.map((fila) => fila.action)).toContain('BARBERIA_CAMBIADA');
    });

    it('sin membresía ni aceptación → 409 UNIRSE_REQUIERE_CONSENTIMIENTO y la sesión de A sigue', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const tokenA = await tokenPara(a.tenantId, cliente.usuarioId as string, 'CLIENTE');
      const { body } = await prueba.agente
        .post(CAMBIO)
        .set({ Authorization: `Bearer ${tokenA}` })
        .send({ barberia: b.slug })
        .expect(409);
      expect(body.codigo).toBe('UNIRSE_REQUIERE_CONSENTIMIENTO');
      await prueba.agente
        .get('/api/v1/auth/yo')
        .set({ Authorization: `Bearer ${tokenA}` })
        .expect(200);
    });

    it('con la aceptación se une a B y cambia', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const tokenA = await tokenPara(a.tenantId, cliente.usuarioId as string, 'CLIENTE');
      const { body } = await prueba.agente
        .post(CAMBIO)
        .set({ Authorization: `Bearer ${tokenA}` })
        .send({
          barberia: b.slug,
          aceptaPoliticaDatos: true,
          versionPoliticaDatos: VERSION,
          telefono: '955 111 222',
        })
        .expect(200);
      expect(decodeJwt(body.tokenAcceso)).toMatchObject({ tid: b.tenantId });
    });

    it('el personal no cambia de barbería → 403', async () => {
      const tokenPropietario = await tokenPara(a.tenantId, a.propietarioId, 'PROPIETARIO');
      const { body } = await prueba.agente
        .post(CAMBIO)
        .set({ Authorization: `Bearer ${tokenPropietario}` })
        .send({ barberia: b.slug })
        .expect(403);
      expect(body.codigo).toBe('ACCESO_DENEGADO');
    });

    it('un enlace inexistente → 404 BARBERIA_NO_DISPONIBLE', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      const tokenA = await tokenPara(a.tenantId, cliente.usuarioId as string, 'CLIENTE');
      const { body } = await prueba.agente
        .post(CAMBIO)
        .set({ Authorization: `Bearer ${tokenA}` })
        .send({ barberia: 'no-existe-esta' })
        .expect(404);
      expect(body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
    });
  });
});
