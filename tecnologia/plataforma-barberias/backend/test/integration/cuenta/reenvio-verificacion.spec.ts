import request from 'supertest';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { correrTareasDeAvisos, descartarAvisosDeOtrasPruebas, esperarCorreos } from '../../helpers/avisos';
import { ipUnica } from '../../helpers/enlaces';
import { type BarberiaSembrada, sembrarBarberia } from '../../helpers/fixtures';
import { iniciarMailpit, type Mailpit } from '../../helpers/mailpit';
import { sesionCliente } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T051 de 010 · Reenvío del correo de verificación (FR-012, FR-013; research R07 y R08; G4):
// - respuesta idéntica con la cuenta verificada o no; una cuenta verificada no recibe correo;
// - el enlace anterior queda anulado;
// - el 4.º en una hora por cuenta → 429 sin correo; el 21.º en una hora desde un mismo origen (cuentas distintas) → 429;
// - el origen se guarda solo como hash; ninguna respuesta por debajo del piso de tiempo.

jest.setTimeout(240_000);

const REENVIO = '/api/v1/cuenta/verificacion/reenvio';
const PISO_MS = Number(process.env.CUENTA_RESPUESTA_MINIMA_MS);

describe('Reenvío del correo de verificación (T051 de 010)', () => {
  let mailpit: Mailpit;
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;

  const reenviar = (token: string, ip = ipUnica()) =>
    request(prueba.app.getHttpServer())
      .post(REENVIO)
      .set({ Authorization: `Bearer ${token}`, 'X-Forwarded-For': ip });

  const enlacesDe = async (usuarioId: string) =>
    (
      await poolDe('seed').query(
        'SELECT revoked_at IS NOT NULL AS anulado FROM account_link WHERE user_id = $1 ORDER BY requested_at',
        [usuarioId],
      )
    ).rows.map((f) => f.anulado as boolean);

  beforeAll(async () => {
    mailpit = await iniciarMailpit();
    prueba = await crearApp({
      entorno: { SMTP_HOST: mailpit.host, SMTP_PUERTO: String(mailpit.puertoSmtp) },
    });
    a = await sembrarBarberia({ nombre: 'Barbería Reenvío' });
  });

  beforeEach(() => descartarAvisosDeOtrasPruebas());

  afterAll(async () => {
    await prueba.cerrar();
    await mailpit.detener();
    await cerrarPools();
  });

  it('misma respuesta verificada o no; solo la cuenta sin verificar recibe el correo', async () => {
    const sinVerificar = await sesionCliente(a.tenantId, undefined, { verificado: false });
    const verificada = await sesionCliente(a.tenantId);

    const inicio = performance.now();
    const r1 = await reenviar(sinVerificar.token).expect(202);
    expect(performance.now() - inicio).toBeGreaterThanOrEqual(PISO_MS - 5);
    const r2 = await reenviar(verificada.token).expect(202);
    expect(r2.body).toEqual(r1.body);
    expect(r1.body).toEqual({ mensaje: expect.any(String) });

    await correrTareasDeAvisos(prueba);
    expect(await esperarCorreos(mailpit, sinVerificar.cliente.correo as string, 1)).toHaveLength(1);
    // La verificada no recibe nada (se espera un poco por si llegara).
    expect(await esperarCorreos(mailpit, verificada.cliente.correo as string, 1, 1500)).toHaveLength(0);
    expect(await enlacesDe(verificada.cliente.usuarioId as string)).toEqual([]);
  });

  it('el reenvío anula el enlace anterior', async () => {
    const { cliente, token } = await sesionCliente(a.tenantId, undefined, { verificado: false });
    await reenviar(token).expect(202);
    await reenviar(token).expect(202);
    expect(await enlacesDe(cliente.usuarioId as string)).toEqual([true, false]);
  });

  it('el 4.º en una hora por cuenta → 429 sin correo nuevo', async () => {
    const { cliente, token } = await sesionCliente(a.tenantId, undefined, { verificado: false });
    for (let i = 0; i < 3; i++) await reenviar(token).expect(202);
    await correrTareasDeAvisos(prueba);
    const antes = (await esperarCorreos(mailpit, cliente.correo as string, 1)).length;

    const bloqueado = await reenviar(token).expect(429);
    expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
    expect(Number(bloqueado.headers['retry-after'])).toBeGreaterThan(0);
    // No se creó un enlace más (siguen 3) ni sale otro correo.
    expect(await enlacesDe(cliente.usuarioId as string)).toHaveLength(3);
    await correrTareasDeAvisos(prueba);
    expect(await esperarCorreos(mailpit, cliente.correo as string, antes + 1, 1500)).toHaveLength(antes);
  });

  it('el 21.º en una hora desde un mismo origen, con cuentas distintas → 429 (G4); el origen se guarda solo como hash', async () => {
    const ip = ipUnica();
    const sesiones = await Promise.all(
      Array.from({ length: 21 }, () => sesionCliente(a.tenantId, undefined, { verificado: false })),
    );
    for (const { token } of sesiones.slice(0, 20)) await reenviar(token, ip).expect(202);
    const bloqueado = await reenviar(sesiones[20].token, ip).expect(429);
    expect(bloqueado.body.codigo).toBe('DEMASIADOS_INTENTOS');
    // La misma cuenta desde otro origen sí puede.
    await reenviar(sesiones[20].token, ipUnica()).expect(202);

    const crudo = JSON.stringify(
      (await poolDe('seed').query("SELECT * FROM account_link_attempt WHERE kind = 'REENVIO'")).rows,
    );
    expect(crudo).not.toContain(ip);
    for (const { cliente } of sesiones) {
      expect(crudo).not.toContain(cliente.usuarioId as string);
      expect(crudo).not.toContain(cliente.correo as string);
    }
  });

  it('sin sesión → 401', async () => {
    await request(prueba.app.getHttpServer()).post(REENVIO).expect(401);
  });
});
