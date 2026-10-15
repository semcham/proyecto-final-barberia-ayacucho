import { createHmac, randomUUID } from 'node:crypto';
import { Controller, Get } from '@nestjs/common';
import { importPKCS8, SignJWT } from 'jose';
import type { Actor } from '../../../src/modules/acceso-barberias';
import { JoseTokenSigner } from '../../../src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer';
import { ActorActual } from '../../../src/host/solicitud';
import { Configuracion, TenantContext } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { KID_PRUEBAS } from '../../helpers/entorno';
import { type BarberiaSembrada, sembrarBarberia, sembrarSesion } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T049 · AuthGuard (PR07 base). Ruta solo de prueba, protegida, que devuelve el actor y el tenant del contexto.

@Controller('__prueba')
class RutaProtegidaDePrueba {
  constructor(private readonly tenantContext: TenantContext) {}

  @Get('protegida')
  protegida(@ActorActual() actor: Actor) {
    return { actor, tenantDelContexto: this.tenantContext.actual().valor };
  }
}

const RUTA = '/api/v1/__prueba/protegida';
const base64url = (valor: object) => Buffer.from(JSON.stringify(valor)).toString('base64url');

describe('AuthGuard (integración)', () => {
  let prueba: AppDePrueba;
  let firmador: JoseTokenSigner;
  let barberia: BarberiaSembrada;
  let sesionActiva: string;
  let sesionCerrada: string;

  const reclamaciones = (sid: string) => ({
    sub: barberia.propietarioId,
    tid: barberia.tenantId,
    rol: 'PROPIETARIO' as const,
    sid,
  });

  async function firmarManual(opciones: { exp?: number; kid?: string }): Promise<string> {
    const clave = await importPKCS8(process.env.JWT_PRIVATE_KEY as string, 'ES256');
    const { sub, tid, rol, sid } = reclamaciones(sesionActiva);
    return new SignJWT({ tid, rol, sid })
      .setProtectedHeader({ alg: 'ES256', kid: opciones.kid ?? KID_PRUEBAS })
      .setSubject(sub)
      .setIssuer('plataforma-barberias')
      .setAudience('plataforma-barberias-web')
      .setIssuedAt()
      .setJti(randomUUID())
      .setExpirationTime(opciones.exp ?? '15m')
      .sign(clave);
  }

  beforeAll(async () => {
    prueba = await crearApp({ controladoresExtra: [RutaProtegidaDePrueba] });
    firmador = new JoseTokenSigner(new Configuracion());
    barberia = await sembrarBarberia();
    sesionActiva = (await sembrarSesion({ tenantId: barberia.tenantId, usuarioId: barberia.propietarioId }))
      .sesionId;
    sesionCerrada = (
      await sembrarSesion({
        tenantId: barberia.tenantId,
        usuarioId: barberia.propietarioId,
        estado: 'CERRADA',
      })
    ).sesionId;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('acepta un token válido, fija el tenant del token y adjunta el actor', async () => {
    const { token } = await firmador.firmar(reclamaciones(sesionActiva));
    const respuesta = await prueba.agente.get(RUTA).set('Authorization', `Bearer ${token}`).expect(200);
    expect(respuesta.body).toEqual({
      actor: {
        usuarioId: barberia.propietarioId,
        tenantId: barberia.tenantId,
        rol: 'PROPIETARIO',
        sesionId: sesionActiva,
      },
      tenantDelContexto: barberia.tenantId,
    });
  });

  describe('rechaza con 401 y el mismo cuerpo, sin explicar el motivo', () => {
    const casos: [string, () => Promise<Record<string, string>>][] = [
      ['sin token', async () => ({})],
      ['esquema distinto de Bearer', async () => ({ Authorization: 'Basic dXN1YXJpbzpjbGF2ZQ==' })],
      [
        'token vencido',
        async () => ({
          Authorization: `Bearer ${await firmarManual({ exp: Math.floor(Date.now() / 1000) - 60 })}`,
        }),
      ],
      [
        'firma alterada',
        async () => {
          const { token } = await firmador.firmar(reclamaciones(sesionActiva));
          const [cabecera, cuerpo, firma] = token.split('.');
          const alterada = `${firma.slice(0, -2)}${firma.endsWith('AA') ? 'BB' : 'AA'}`;
          return { Authorization: `Bearer ${cabecera}.${cuerpo}.${alterada}` };
        },
      ],
      [
        'cuerpo alterado (otro tenant) sin volver a firmar',
        async () => {
          const { token } = await firmador.firmar(reclamaciones(sesionActiva));
          const [cabecera, , firma] = token.split('.');
          const cuerpo = base64url({ ...reclamaciones(sesionActiva), tid: randomUUID(), exp: 9999999999 });
          return { Authorization: `Bearer ${cabecera}.${cuerpo}.${firma}` };
        },
      ],
      [
        'algoritmo none',
        async () => {
          const cuerpo = base64url({ ...reclamaciones(sesionActiva), exp: 9999999999, iat: 1, jti: 'x' });
          return { Authorization: `Bearer ${base64url({ alg: 'none', typ: 'JWT' })}.${cuerpo}.` };
        },
      ],
      [
        'algoritmo HS256',
        async () => {
          const cabecera = base64url({ alg: 'HS256', typ: 'JWT', kid: KID_PRUEBAS });
          const cuerpo = base64url({ ...reclamaciones(sesionActiva), exp: 9999999999, iat: 1, jti: 'x' });
          const firma = createHmac('sha256', 'secreto-cualquiera')
            .update(`${cabecera}.${cuerpo}`)
            .digest('base64url');
          return { Authorization: `Bearer ${cabecera}.${cuerpo}.${firma}` };
        },
      ],
      [
        'kid desconocido',
        async () => ({ Authorization: `Bearer ${await firmarManual({ kid: 'otra-clave' })}` }),
      ],
      [
        'sesión cerrada',
        async () => ({
          Authorization: `Bearer ${(await firmador.firmar(reclamaciones(sesionCerrada))).token}`,
        }),
      ],
      [
        'sesión inexistente',
        async () => ({
          Authorization: `Bearer ${(await firmador.firmar(reclamaciones(randomUUID()))).token}`,
        }),
      ],
    ];

    it.each(casos)('%s', async (_caso, encabezados) => {
      const respuesta = await prueba.agente
        .get(RUTA)
        .set(await encabezados())
        .expect(401);
      expect(respuesta.body).toEqual({
        codigo: 'NO_AUTENTICADO',
        mensaje: 'Inicia sesión para continuar.',
        detalles: [],
      });
    });
  });

  it('rechaza con 400 un encabezado X-Tenant-Id aunque el token sea válido', async () => {
    const { token } = await firmador.firmar(reclamaciones(sesionActiva));
    const respuesta = await prueba.agente
      .get(RUTA)
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', randomUUID())
      .expect(400);
    expect(respuesta.body.codigo).toBe('VALIDACION');
  });

  it('GET /salud es pública y responde 200', async () => {
    await prueba.agente.get('/api/v1/salud').expect(200, { estado: 'ok' });
  });

  it('una ruta inexistente responde 404 con el formato de error del contrato', async () => {
    const respuesta = await prueba.agente.get('/api/v1/no-existe').expect(404);
    expect(respuesta.body.codigo).toBe('NO_ENCONTRADO');
  });
});
