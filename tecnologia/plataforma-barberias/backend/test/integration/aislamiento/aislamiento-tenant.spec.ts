import { JoseTokenSigner } from '../../../src/modules/acceso-barberias/identidad/infrastructure/jose-token-signer';
import { Configuracion } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaSembrada,
  filasDe,
  sembrarBarberia,
  sembrarSesion,
  sembrarSuscripcion,
  sembrarUsuario,
} from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';
import { ENDPOINTS_PROTEGIDOS, type EndpointProtegido } from './endpoints-protegidos';

const DIA_MS = 24 * 60 * 60 * 1000;

// T091 · PR09 HTTP: con el token de A, ningún intento explícito de indicar la barbería B llega a ejecutarse;
// cada intento queda auditado en A y los datos de B no cambian.

const CAMPOS_DE_TENANT = ['tenantId', 'tenant_id', 'barberiaId'] as const;
const TABLAS_DE_B = [
  'membership',
  'auth_session',
  'account_activation',
  'terms_acceptance',
  'subscription',
  'audit_log',
];

type Vector = 'cuerpo' | 'consulta' | 'encabezado';

describe('PR09 · Aislamiento entre barberías por HTTP', () => {
  let prueba: AppDePrueba;
  let firmador: JoseTokenSigner;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  let pendienteDeA: string;
  let barberoDeB: string;
  let pendienteDeB: string;

  async function tokenDeA(): Promise<string> {
    const { sesionId } = await sembrarSesion({ tenantId: a.tenantId, usuarioId: a.propietarioId });
    const { token } = await firmador.firmar({
      sub: a.propietarioId,
      tid: a.tenantId,
      rol: 'PROPIETARIO',
      sid: sesionId,
    });
    return token;
  }

  async function datosDeB(): Promise<Record<string, unknown[]>> {
    const datos: Record<string, unknown[]> = {};
    for (const tabla of TABLAS_DE_B) datos[tabla] = await filasDe(tabla, b.tenantId);
    return datos;
  }

  async function atacar(endpoint: EndpointProtegido, vector: Vector, campo: string, token: string) {
    const ruta = endpoint.ruta.replace('{idUsuarioPropio}', pendienteDeA);
    const rutaConConsulta = vector === 'consulta' ? `${ruta}?${campo}=${b.tenantId}` : ruta;
    let solicitud = prueba.agente[endpoint.metodo](rutaConConsulta).set('Authorization', `Bearer ${token}`);
    if (vector === 'encabezado') solicitud = solicitud.set('X-Tenant-Id', b.tenantId);
    if (endpoint.cuerpo !== undefined || vector === 'cuerpo') {
      solicitud = solicitud.send(
        vector === 'cuerpo' ? { ...endpoint.cuerpo, [campo]: b.tenantId } : endpoint.cuerpo,
      );
    }
    return solicitud;
  }

  beforeAll(async () => {
    prueba = await crearApp();
    firmador = new JoseTokenSigner(new Configuracion());
    a = await sembrarBarberia({ nombre: 'Barbería A' });
    b = await sembrarBarberia({ nombre: 'Barbería B' });
    for (const barberia of [a, b]) {
      await sembrarSuscripcion({
        tenantId: barberia.tenantId,
        trialEndsAt: new Date(Date.now() + 14 * DIA_MS),
      });
    }
    await sembrarSesion({ tenantId: b.tenantId, usuarioId: b.propietarioId });
    pendienteDeA = (
      await sembrarUsuario({ tenantId: a.tenantId, rol: 'BARBERO', estado: 'PENDIENTE', contrasena: null })
    ).usuarioId;
    barberoDeB = (await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' })).usuarioId;
    pendienteDeB = (
      await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'PENDIENTE', contrasena: null })
    ).usuarioId;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const casos = ENDPOINTS_PROTEGIDOS.flatMap((endpoint) => [
    ...CAMPOS_DE_TENANT.map((campo) => ({ endpoint, vector: 'cuerpo' as Vector, campo })).filter(
      ({ endpoint: e }) => e.metodo !== 'get',
    ),
    ...CAMPOS_DE_TENANT.map((campo) => ({ endpoint, vector: 'consulta' as Vector, campo })),
    { endpoint, vector: 'encabezado' as Vector, campo: 'X-Tenant-Id' },
  ]);

  it.each(
    casos.map((caso) => [
      `${caso.endpoint.metodo.toUpperCase()} ${caso.endpoint.ruta} · ${caso.vector} · ${caso.campo}`,
      caso,
    ]),
  )('%s → 400, auditado en A, sin cambios en B', async (_nombre, { endpoint, vector, campo }) => {
    const token = await tokenDeA();
    const antesB = await datosDeB();
    const auditoriaAntesA = (await filasDe('audit_log', a.tenantId)).length;

    const respuesta = await atacar(endpoint, vector, campo, token);

    expect(respuesta.status).toBe(400);
    expect(respuesta.body.codigo).toBe('VALIDACION');
    expect(JSON.stringify(respuesta.body)).not.toContain('Barbería B');
    expect(await datosDeB()).toEqual(antesB);

    const auditoriaA = await filasDe('audit_log', a.tenantId);
    expect(auditoriaA).toHaveLength(auditoriaAntesA + 1);
    expect(auditoriaA).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'ACCESO_TENANT_AJENO',
          actor_id: a.propietarioId,
          result: 'DENEGADO',
        }),
      ]),
    );
  });

  it('GET /auth/yo sin campos de tenant solo muestra la barbería del token', async () => {
    const respuesta = await prueba.agente
      .get('/api/v1/auth/yo')
      .set('Authorization', `Bearer ${await tokenDeA()}`)
      .expect(200);
    expect(respuesta.body.barberia).toMatchObject({ id: a.tenantId, nombre: 'Barbería A' });
    expect(JSON.stringify(respuesta.body)).not.toContain(b.tenantId);
  });

  describe('con el token de A y el id de un usuario de B (US4)', () => {
    async function cuentaDeB(id: string) {
      const { rows } = await poolDe('seed').query('SELECT email, full_name FROM user_account WHERE id = $1', [
        id,
      ]);
      return rows[0];
    }

    it.each([
      [
        'GET /usuarios/{id de B}',
        (t: string) =>
          prueba.agente.get(`/api/v1/usuarios/${barberoDeB}`).set('Authorization', `Bearer ${t}`),
      ],
      [
        'PATCH /usuarios/{id de B}',
        (t: string) =>
          prueba.agente
            .patch(`/api/v1/usuarios/${barberoDeB}`)
            .set('Authorization', `Bearer ${t}`)
            .send({ estado: 'DESACTIVADA' }),
      ],
      [
        'POST /usuarios/{id de B}/activacion',
        (t: string) =>
          prueba.agente
            .post(`/api/v1/usuarios/${pendienteDeB}/activacion`)
            .set('Authorization', `Bearer ${t}`),
      ],
    ])('%s → 404, sin cambios en B y sin registrar ACCESO_TENANT_AJENO', async (_caso, solicitar) => {
      const antesB = await datosDeB();
      const cuentaAntes = await cuentaDeB(barberoDeB);
      const ajenosAntes = (await filasDe('audit_log', a.tenantId)).filter(
        (f) => f.action === 'ACCESO_TENANT_AJENO',
      ).length;

      const respuesta = await solicitar(await tokenDeA());

      expect(respuesta.status).toBe(404);
      expect(respuesta.body.codigo).toBe('NO_ENCONTRADO');
      expect(await datosDeB()).toEqual(antesB);
      expect(await cuentaDeB(barberoDeB)).toEqual(cuentaAntes);
      // Escenario 4 de US3: un id ajeno solo recibe "no encontrado"; no se registra como intento entre barberías.
      const ajenos = (await filasDe('audit_log', a.tenantId)).filter(
        (f) => f.action === 'ACCESO_TENANT_AJENO',
      ).length;
      expect(ajenos).toBe(ajenosAntes);
    });

    it('GET /usuarios de A no lista a nadie de B', async () => {
      const respuesta = await prueba.agente
        .get('/api/v1/usuarios?tamano=100')
        .set('Authorization', `Bearer ${await tokenDeA()}`)
        .expect(200);
      const ids = respuesta.body.datos.map((u: { id: string }) => u.id);
      expect(ids).toEqual(expect.arrayContaining([a.propietarioId, pendienteDeA]));
      expect(ids).not.toContain(b.propietarioId);
      expect(ids).not.toContain(barberoDeB);
      expect(ids).not.toContain(pendienteDeB);
      expect(respuesta.body.total).toBe(ids.length);
    });
  });

  it('el cierre de sesión rechazado por un campo de tenant no cerró la sesión de A', async () => {
    const token = await tokenDeA();
    await prueba.agente
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .send({ tenantId: b.tenantId })
      .expect(400);
    await prueba.agente.get('/api/v1/auth/yo').set('Authorization', `Bearer ${token}`).expect(200);
  });
});
