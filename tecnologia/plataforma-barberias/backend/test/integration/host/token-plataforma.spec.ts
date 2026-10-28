import { randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';
import type { ActorPlataforma } from '../../../src/modules/acceso-barberias';
import { AdminActual, Plataforma } from '../../../src/host/solicitud';
import { TenantContext } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { KID_PRUEBAS } from '../../helpers/entorno';
import { crearEscenario, tokenPara, tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T016 · Token de plataforma en el AuthGuard (ADR-031, constitución 1.3.1): el token del administrador
// (aud "plataforma", sin tid) sirve SOLO en rutas @Plataforma() y nunca fija un tenant; las rutas de barbería
// lo rechazan, y las rutas @Plataforma() rechazan cualquier token de barbería.

@Controller('__prueba')
class RutaDePlataformaDePrueba {
  constructor(private readonly tenantContext: TenantContext) {}

  @Plataforma()
  @Get('plataforma')
  plataforma(@AdminActual() admin: ActorPlataforma) {
    let tenant: string | null;
    try {
      tenant = this.tenantContext.actual().valor;
    } catch {
      tenant = null;
    }
    return { admin, tenant };
  }
}

const RUTA = '/api/v1/__prueba/plataforma';
const NO_AUTENTICADO = { codigo: 'NO_AUTENTICADO', mensaje: 'Inicia sesión para continuar.', detalles: [] };

/** Firma un token a mano con la clave de las pruebas, para casos que el firmador nunca emite. */
async function firmarAMano(reclamaciones: Record<string, unknown>, audiencia: string): Promise<string> {
  const clave = await importPKCS8(process.env.JWT_PRIVATE_KEY as string, 'ES256');
  return new SignJWT(reclamaciones)
    .setProtectedHeader({ alg: 'ES256', kid: KID_PRUEBAS })
    .setSubject(randomUUID())
    .setIssuer('plataforma-barberias')
    .setAudience(audiencia)
    .setIssuedAt()
    .setJti(randomUUID())
    .setExpirationTime('5m')
    .sign(clave);
}

describe('Token de plataforma en el AuthGuard (T016)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp({ controladoresExtra: [RutaDePlataformaDePrueba] });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('el token de plataforma sirve en una ruta @Plataforma(), con el administrador y sin tenant', async () => {
    const adminId = randomUUID();
    const { token, sesionId } = await tokenPlataformaPara(adminId);
    const respuesta = await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(200);
    expect(respuesta.body).toEqual({
      admin: { adminId, rol: 'ADMIN_PLATAFORMA', sesionId },
      tenant: null,
    });
  });

  it.each(['/api/v1/agenda', '/api/v1/clientes', '/api/v1/servicios', '/api/v1/usuarios', '/api/v1/auth/yo'])(
    'el token de plataforma responde 401 en la ruta de barbería %s',
    async (ruta) => {
      const { token } = await tokenPlataformaPara(randomUUID());
      const respuesta = await prueba.agente.get(ruta).set('Authorization', `Bearer ${token}`).expect(401);
      expect(respuesta.body).toEqual(NO_AUTENTICADO);
    },
  );

  it.each(['PROPIETARIO', 'BARBERO'] as const)(
    'un token de barbería (%s) responde 401 en una ruta @Plataforma()',
    async (rol) => {
      const escenario = await crearEscenario();
      const token =
        rol === 'PROPIETARIO'
          ? escenario.tokenPropietario
          : await tokenPara(escenario.barberia.tenantId, escenario.barberoActivo.id, 'BARBERO');
      const respuesta = await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401);
      expect(respuesta.body).toEqual(NO_AUTENTICADO);
    },
  );

  it('sin token, una ruta @Plataforma() responde 401', async () => {
    await prueba.agente.get(RUTA).expect(401, NO_AUTENTICADO);
  });

  it('un token sin tid y sin aud "plataforma" responde 401 en las dos vías', async () => {
    const token = await firmarAMano(
      { rol: 'ADMIN_PLATAFORMA', sid: randomUUID() },
      'plataforma-barberias-web',
    );
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401, NO_AUTENTICADO);
    await prueba.agente
      .get('/api/v1/agenda')
      .set('Authorization', `Bearer ${token}`)
      .expect(401, NO_AUTENTICADO);
  });

  it('un token con aud "plataforma" pero con tid responde 401 (el administrador no tiene barbería)', async () => {
    const token = await firmarAMano(
      { rol: 'ADMIN_PLATAFORMA', sid: randomUUID(), tid: randomUUID() },
      'plataforma',
    );
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401, NO_AUTENTICADO);
  });

  it('un token con aud "plataforma" y otro rol responde 401', async () => {
    const token = await firmarAMano({ rol: 'PROPIETARIO', sid: randomUUID() }, 'plataforma');
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401, NO_AUTENTICADO);
  });

  it('un token de plataforma vencido responde 401', async () => {
    const clave = await importPKCS8(process.env.JWT_PRIVATE_KEY as string, 'ES256');
    const token = await new SignJWT({ rol: 'ADMIN_PLATAFORMA', sid: randomUUID() })
      .setProtectedHeader({ alg: 'ES256', kid: KID_PRUEBAS })
      .setSubject(randomUUID())
      .setIssuer('plataforma-barberias')
      .setAudience('plataforma')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 1200)
      .setJti(randomUUID())
      .setExpirationTime(Math.floor(Date.now() / 1000) - 600)
      .sign(clave);
    await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(401, NO_AUTENTICADO);
  });
});
