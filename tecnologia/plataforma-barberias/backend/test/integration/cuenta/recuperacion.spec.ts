import request from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { correrTareasDeAvisos, descartarAvisosDeOtrasPruebas, esperarCorreos } from '../../helpers/avisos';
import { ipUnica } from '../../helpers/enlaces';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarCliente,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { tokenDelCorreo } from '../../helpers/verificacion';

// T070 de 010 · Recuperación de la contraseña (US2; FR-018 a FR-023; research R03, R04 y R12):
// - con y sin cuenta, la misma respuesta; el personal PENDIENTE no recibe enlace;
// - el enlace vence a la hora, sirve una vez y reemplaza al anterior;
// - la contraseña nueva cumple las reglas (también la del propio correo): si no, 422 y el enlace sigue sirviendo;
// - al cambiarla se cierran las sesiones en dos barberías (acceso y renovación fallan), la cuenta queda verificada y
//   llega el correo CONTRASENA_CAMBIADA;
// - la barbería del aviso sigue R03 (slug con y sin membresía, personal, solo cliente).

jest.setTimeout(240_000);

const RECUPERAR = '/api/v1/cuenta/recuperacion';
const RESTABLECER = '/api/v1/cuenta/recuperacion/contrasena';
const NUEVA = 'otra-clave-bien-larga-2026';

describe('Recuperación de la contraseña (T070 de 010)', () => {
  let mailpit: Mailpit;
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  const http = () => request(prueba.app.getHttpServer());
  const pedir = (correo: string, barberia?: string) =>
    http()
      .post(RECUPERAR)
      .set('X-Forwarded-For', ipUnica())
      .send({ correo, ...(barberia && { barberia }) });
  const restablecer = (token: string, contrasena = NUEVA) =>
    http().post(RESTABLECER).set('X-Forwarded-For', ipUnica()).send({ token, contrasena });

  const enlacesDe = async (usuarioId: string) =>
    (
      await poolDe('seed').query(
        `SELECT tenant_id, expires_at - requested_at AS vigencia, revoked_at IS NOT NULL AS anulado
         FROM account_link WHERE user_id = $1 AND purpose = 'RECUPERAR_CONTRASENA' ORDER BY requested_at`,
        [usuarioId],
      )
    ).rows;

  /** Envía los avisos y devuelve el token del n-ésimo correo de recuperación de `correo`. */
  async function tokenRecibido(correo: string, n = 1): Promise<string> {
    await correrTareasDeAvisos(prueba);
    const correos = (await esperarCorreos(mailpit, correo, n)).filter((c) =>
      c.texto.includes('/restablecer#'),
    );
    expect(correos.length).toBeGreaterThanOrEqual(n);
    return tokenDelCorreo(correos[n - 1].texto, 'restablecer');
  }

  async function ingresar(correo: string, contrasena: string, barberia?: string) {
    const agente = request.agent(prueba.app.getHttpServer());
    const respuesta = await agente
      .post('/api/v1/auth/login')
      .set('X-Forwarded-For', ipUnica())
      .send({ correo, contrasena, ...(barberia && { barberia }) });
    return { agente, respuesta };
  }

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    prueba = await crearApp({
      entorno: { SMTP_HOST: mailpit.host, SMTP_PUERTO: String(mailpit.puertoSmtp) },
    });
    a = await sembrarBarberia({ nombre: 'Barbería Recupera A' });
    b = await sembrarBarberia({ nombre: 'Barbería Recupera B' });
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await prueba.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('con y sin cuenta, el mismo 202 y el mismo cuerpo; sin cuenta no se crea nada', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    const con = await pedir(cliente.correo as string).expect(202);
    const sin = await pedir(`nadie-${Date.now()}@prueba.pe`).expect(202);
    const malEscrito = await pedir('esto no es un correo').expect(202);
    expect(sin.body).toEqual(con.body);
    expect(malEscrito.body).toEqual(con.body);
    expect(con.body).toEqual({ mensaje: expect.any(String) });
    expect(await enlacesDe(cliente.usuarioId as string)).toHaveLength(1);
  });

  it('el personal PENDIENTE no recibe enlace (su camino es la activación)', async () => {
    const pendiente = await sembrarUsuario({
      tenantId: a.tenantId,
      rol: 'BARBERO',
      estado: 'PENDIENTE',
      contrasena: null,
    });
    await pedir(pendiente.correo).expect(202);
    expect(await enlacesDe(pendiente.usuarioId)).toEqual([]);
    await correrTareasDeAvisos(prueba);
    expect(await esperarCorreos(mailpit, pendiente.correo, 1, 1500)).toHaveLength(0);
  });

  it('el enlace vale 1 hora, sirve una sola vez y el nuevo anula al anterior', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    const correo = cliente.correo as string;
    await pedir(correo).expect(202);
    const primero = await tokenRecibido(correo);
    await pedir(correo).expect(202);
    const segundo = await tokenRecibido(correo, 2);
    expect(segundo).not.toBe(primero);

    const enlaces = await enlacesDe(cliente.usuarioId as string);
    expect(enlaces.map((e) => e.anulado)).toEqual([true, false]);
    expect(enlaces[1].vigencia).toMatchObject({ hours: 1 });

    const anulado = await restablecer(primero).expect(410);
    expect(anulado.body.codigo).toBe('ENLACE_NO_VALIDO');
    await restablecer(segundo).expect(204);
    const usado = await restablecer(segundo, 'una-tercera-clave-larga').expect(410);
    expect(usado.body).toEqual(anulado.body);
  });

  it('vencido (pedido hace más de 1 hora): el mismo 410', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    await pedir(cliente.correo as string).expect(202);
    const token = await tokenRecibido(cliente.correo as string);
    await poolDe('seed').query(
      `UPDATE account_link SET requested_at = requested_at - interval '2 hours', expires_at = expires_at - interval '2 hours'
       WHERE user_id = $1`,
      [cliente.usuarioId],
    );
    expect((await restablecer(token).expect(410)).body.codigo).toBe('ENLACE_NO_VALIDO');
  });

  it('una contraseña que no cumple las reglas (común o con el propio correo) → 422 y el enlace sigue sirviendo', async () => {
    const cliente = await sembrarCliente({
      tenantId: a.tenantId,
      correo: `rosalinda-${Date.now()}@prueba.pe`,
    });
    const correo = cliente.correo as string;
    await pedir(correo).expect(202);
    const token = await tokenRecibido(correo);

    const comun = await restablecer(token, 'password123').expect(422);
    expect(comun.body).toMatchObject({
      codigo: 'VALIDACION',
      detalles: [{ campo: 'contrasena', problema: 'muy_comun' }],
    });
    const conCorreo = await restablecer(token, `${correo.split('@')[0]}-segura`).expect(422);
    expect(conCorreo.body.detalles).toEqual([{ campo: 'contrasena', problema: 'contiene_correo' }]);
    // Nada cambió: la contraseña anterior sigue entrando y el enlace sigue sirviendo.
    expect((await ingresar(correo, cliente.contrasena as string, a.slug)).respuesta.status).toBe(200);
    await restablecer(token).expect(204);
  });

  it('al cambiarla: se cierran las sesiones en dos barberías, la cuenta queda verificada y llega el aviso', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId, verificado: false });
    await sembrarCliente({ tenantId: b.tenantId, usuarioId: cliente.usuarioId as string });
    const correo = cliente.correo as string;
    const anterior = cliente.contrasena as string;
    const sesiones = [await ingresar(correo, anterior, a.slug), await ingresar(correo, anterior, b.slug)];
    for (const s of sesiones) expect(s.respuesta.status).toBe(200);

    await pedir(correo, b.slug).expect(202);
    await restablecer(await tokenRecibido(correo)).expect(204);

    for (const { agente, respuesta } of sesiones) {
      await agente
        .get('/api/v1/auth/yo')
        .set('Authorization', `Bearer ${respuesta.body.tokenAcceso}`)
        .expect(401);
      await agente.post('/api/v1/auth/refresh').expect(401);
    }
    expect((await ingresar(correo, anterior, a.slug)).respuesta.status).toBe(401);
    const nueva = await ingresar(correo, NUEVA, a.slug);
    expect(nueva.respuesta.status).toBe(200);
    expect(nueva.respuesta.body.usuario.correoVerificado).toBe(true);
    const [cuenta] = (
      await poolDe('seed').query('SELECT email_verified_via AS via FROM user_account WHERE id = $1', [
        cliente.usuarioId,
      ])
    ).rows;
    expect(cuenta.via).toBe('ENLACE');

    await correrTareasDeAvisos(prueba);
    const correos = await esperarCorreos(mailpit, correo, 2);
    const aviso = correos.find((c) => /contraseña cambió|cambiaste tu contraseña/i.test(c.asunto));
    expect(aviso).toBeDefined();
    expect(aviso?.texto).not.toContain(NUEVA);
    expect(aviso?.texto).not.toContain(correo);
  });

  describe('la barbería del aviso (research R03)', () => {
    it('desde el ingreso de una barbería donde la cuenta es cliente: esa barbería', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      await sembrarCliente({ tenantId: b.tenantId, usuarioId: cliente.usuarioId as string });
      await pedir(cliente.correo as string, a.slug).expect(202);
      expect((await enlacesDe(cliente.usuarioId as string)).map((e) => e.tenant_id)).toEqual([a.tenantId]);
    });

    it('desde una barbería donde NO tiene membresía: se ignora y usa la suya (sin revelar nada)', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      await pedir(cliente.correo as string, b.slug).expect(202);
      expect((await enlacesDe(cliente.usuarioId as string)).map((e) => e.tenant_id)).toEqual([a.tenantId]);
    });

    it('desde el ingreso general, el personal: la barbería del personal', async () => {
      const barbero = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
      await pedir(barbero.correo).expect(202);
      expect((await enlacesDe(barbero.usuarioId)).map((e) => e.tenant_id)).toEqual([b.tenantId]);
    });

    it('desde el ingreso general, solo cliente: su membresía de cliente más reciente', async () => {
      const cliente = await sembrarCliente({ tenantId: a.tenantId });
      await sembrarCliente({ tenantId: b.tenantId, usuarioId: cliente.usuarioId as string });
      await pedir(cliente.correo as string).expect(202);
      expect((await enlacesDe(cliente.usuarioId as string)).map((e) => e.tenant_id)).toEqual([b.tenantId]);
    });

    it('el propietario también recupera su contraseña (todos los roles)', async () => {
      await pedir(a.correo).expect(202);
      const token = await tokenRecibido(a.correo);
      await restablecer(token, 'clave-nueva-del-propietario').expect(204);
      expect((await ingresar(a.correo, 'clave-nueva-del-propietario')).respuesta.status).toBe(200);
    });
  });
});
