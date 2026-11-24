import { randomBytes } from 'node:crypto';
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

// T071 de 010 · Límites de la recuperación (research R08: 3 por hora por cuenta, 10 por hora por origen, 20 usos fallidos
// por hora por origen) y aislamiento (PR09): un enlace emitido con la barbería A no da acceso a datos de B.

jest.setTimeout(240_000);

const RECUPERAR = '/api/v1/cuenta/recuperacion';
const RESTABLECER = '/api/v1/cuenta/recuperacion/contrasena';

describe('Límites y aislamiento de la recuperación (T071 de 010)', () => {
  let mailpit: Mailpit;
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;

  const pedir = (correo: string, ip = ipUnica()) =>
    request(prueba.app.getHttpServer()).post(RECUPERAR).set('X-Forwarded-For', ip).send({ correo });
  const restablecer = (token: string, ip = ipUnica(), contrasena = 'clave-nueva-larga-2026') =>
    request(prueba.app.getHttpServer())
      .post(RESTABLECER)
      .set('X-Forwarded-For', ip)
      .send({ token, contrasena });
  const enlaces = async (usuarioId: string) =>
    Number(
      (
        await poolDe('seed').query(
          `SELECT count(*) AS n FROM account_link WHERE user_id = $1 AND purpose = 'RECUPERAR_CONTRASENA'`,
          [usuarioId],
        )
      ).rows[0].n,
    );

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    prueba = await crearApp({
      entorno: { SMTP_HOST: mailpit.host, SMTP_PUERTO: String(mailpit.puertoSmtp) },
    });
    a = await sembrarBarberia({ nombre: 'Barbería Límites A' });
    b = await sembrarBarberia({ nombre: 'Barbería Límites B' });
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await prueba.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('el 4.º pedido en una hora para la misma cuenta → 429 sin enlace nuevo (desde orígenes distintos)', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    for (let i = 0; i < 3; i++) await pedir(cliente.correo as string).expect(202);
    const bloqueado = await pedir(cliente.correo as string).expect(429);
    expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    expect(await enlaces(cliente.usuarioId as string)).toBe(3);
  });

  it('el mismo límite por cuenta vale para un correo SIN cuenta (no revela si existe)', async () => {
    const correo = `nadie-${Date.now()}@prueba.pe`;
    for (let i = 0; i < 3; i++) await pedir(correo).expect(202);
    expect((await pedir(correo).expect(429)).body.codigo).toBe('DEMASIADOS_INTENTOS');
  });

  it('el 11.º pedido en una hora desde un mismo origen (correos distintos) → 429', async () => {
    const ip = ipUnica();
    for (let i = 0; i < 10; i++) await pedir(`origen-${i}-${Date.now()}@prueba.pe`, ip).expect(202);
    await pedir(`origen-11-${Date.now()}@prueba.pe`, ip).expect(429);
    await pedir(`otro-${Date.now()}@prueba.pe`).expect(202);
  });

  it('el uso fallido n.º 21 de un enlace de recuperación desde un mismo origen → 429', async () => {
    const ip = ipUnica();
    for (let i = 0; i < 20; i++) await restablecer(randomBytes(32).toString('base64url'), ip).expect(410);
    expect((await restablecer(randomBytes(32).toString('base64url'), ip).expect(429)).body.codigo).toBe(
      'DEMASIADOS_INTENTOS',
    );
  });

  it('PR09: un enlace emitido en A cambia SOLO la contraseña de esa cuenta; el personal de B sigue igual', async () => {
    const cliente = await sembrarCliente({ tenantId: a.tenantId });
    const deB = await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const antes = (
      await poolDe('seed').query(
        'SELECT id, password_hash FROM user_account WHERE id = ANY($1) ORDER BY id',
        [[deB.usuarioId, b.propietarioId]],
      )
    ).rows;
    await pedir(cliente.correo as string).expect(202);
    await correrTareasDeAvisos(prueba);
    const [correo] = await esperarCorreos(mailpit, cliente.correo as string, 1);
    const token = tokenDelCorreo(correo.texto, 'restablecer');
    await restablecer(token).expect(204);

    const despues = (
      await poolDe('seed').query(
        'SELECT id, password_hash FROM user_account WHERE id = ANY($1) ORDER BY id',
        [[deB.usuarioId, b.propietarioId]],
      )
    ).rows;
    expect(despues).toEqual(antes);
    // El enlace y su auditoría quedan solo en A.
    const [enlace] = (
      await poolDe('seed').query(
        `SELECT tenant_id FROM account_link WHERE user_id = $1 AND purpose = 'RECUPERAR_CONTRASENA'`,
        [cliente.usuarioId],
      )
    ).rows;
    expect(enlace.tenant_id).toBe(a.tenantId);
    const auditoriaEnB = await poolDe('seed').query(
      `SELECT 1 FROM audit_log WHERE tenant_id = $1 AND actor_id = $2`,
      [b.tenantId, cliente.usuarioId],
    );
    expect(auditoriaEnB.rows).toEqual([]);
    // Con el rol de la aplicación y la barbería B, el enlace de A no se ve.
    const conexion = await poolDe('app').connect();
    try {
      await conexion.query('BEGIN');
      await conexion.query("SELECT set_config('app.tenant_id', $1, true)", [b.tenantId]);
      const visibles = await conexion.query('SELECT id FROM account_link WHERE user_id = $1', [
        cliente.usuarioId,
      ]);
      expect(visibles.rows).toEqual([]);
    } finally {
      await conexion.query('ROLLBACK');
      conexion.release();
    }
  });
});
