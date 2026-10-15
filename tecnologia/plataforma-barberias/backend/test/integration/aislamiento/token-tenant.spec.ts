import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { importPKCS8, SignJWT } from 'jose';
import { JoseTokenSigner } from '../../../src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer';
import { Configuracion } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { KID_PRUEBAS } from '../../helpers/entorno';
import { type BarberiaSembrada, sembrarBarberia, sembrarSesion } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T092 · El tenant solo sale de un token firmado por la plataforma: otra clave o un tid alterado dan 401.

const RUTA = '/api/v1/auth/yo';

describe('PR09 · El tenant del token no se puede falsificar', () => {
  let prueba: AppDePrueba;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  let sesionDeB: string;

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrarBarberia();
    b = await sembrarBarberia();
    sesionDeB = (await sembrarSesion({ tenantId: b.tenantId, usuarioId: b.propietarioId })).sesionId;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('un token con las reclamaciones de B pero firmado con una clave ajena (mismo kid) da 401', async () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const claveAjena = await importPKCS8(
      privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      'ES256',
    );
    const token = await new SignJWT({ tid: b.tenantId, rol: 'PROPIETARIO', sid: sesionDeB })
      .setProtectedHeader({ alg: 'ES256', kid: KID_PRUEBAS })
      .setSubject(b.propietarioId)
      .setIssuer('plataforma-barberias')
      .setAudience('plataforma-barberias-web')
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime('15m')
      .sign(claveAjena);
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401);
  });

  it('cambiar el tid de un token válido de A por el de B sin volver a firmar da 401', async () => {
    const { sesionId } = await sembrarSesion({ tenantId: a.tenantId, usuarioId: a.propietarioId });
    const firmador = new JoseTokenSigner(new Configuracion());
    const { token } = await firmador.firmar({
      sub: a.propietarioId,
      tid: a.tenantId,
      rol: 'PROPIETARIO',
      sid: sesionId,
    });
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(200);

    const [cabecera, cuerpo, firma] = token.split('.');
    const reclamaciones = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    const alterado = Buffer.from(JSON.stringify({ ...reclamaciones, tid: b.tenantId })).toString('base64url');
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${cabecera}.${alterado}.${firma}`).expect(401);
  });

  it('un token bien firmado cuyo tid no coincide con la barbería de la sesión da 401', async () => {
    // sid de B con tid de A: la sesión no existe en el tenant del token.
    const firmador = new JoseTokenSigner(new Configuracion());
    const { token } = await firmador.firmar({
      sub: b.propietarioId,
      tid: a.tenantId,
      rol: 'PROPIETARIO',
      sid: sesionDeB,
    });
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401);
  });
});
