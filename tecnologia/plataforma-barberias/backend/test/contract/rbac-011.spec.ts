import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../helpers/app';
import { filasDe, sembrarBarberia, sembrarUsuario } from '../helpers/fixtures';
import { sesionCliente, tokenPara, tokenPlataformaPara } from '../helpers/sesiones';
import { cerrarPools, poolDe } from '../helpers/test-db';

// T017 de 011 · RBAC de la carga en lote (FR-018): solo el PROPIETARIO (GESTIONAR_SERVICIOS). El barbero y el cliente
// reciben 403 auditado como ACCESO_DENEGADO_ROL; sin sesión o con el token de la plataforma, 401. Nada se crea.

const RUTAS = ['/api/v1/servicios/lote/revision', '/api/v1/servicios/lote'];
const CUERPO = { filas: [{ nombre: 'Corte', duracionMinutos: 30, precio: '25' }] };

describe('RBAC 011: servicios en lote', () => {
  let prueba: AppDePrueba;
  let tenantId: string;
  let tokens: Record<'PROPIETARIO' | 'BARBERO' | 'CLIENTE', string>;
  let plataforma: string;

  beforeAll(async () => {
    prueba = await crearApp();
    const b = await sembrarBarberia();
    tenantId = b.tenantId;
    const u = await sembrarUsuario({ tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    tokens = {
      PROPIETARIO: await tokenPara(tenantId, b.propietarioId, 'PROPIETARIO'),
      BARBERO: await tokenPara(tenantId, u.usuarioId, 'BARBERO'),
      CLIENTE: (await sesionCliente(tenantId)).token,
    };
    plataforma = (await tokenPlataformaPara()).token;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const pedir = (ruta: string, token: string | null) =>
    prueba.agente
      .post(ruta)
      .set({ ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': randomUUID() })
      .send(CUERPO);

  const servicios = async () =>
    (
      await poolDe('seed').query<{ n: number }>(
        'SELECT count(*)::int AS n FROM service WHERE tenant_id = $1',
        [tenantId],
      )
    ).rows[0].n;

  it.each(RUTAS)('%s: el propietario puede', async (ruta) => {
    const r = await pedir(ruta, tokens.PROPIETARIO);
    expect([200, 201]).toContain(r.status);
  });

  it.each(RUTAS.flatMap((ruta) => (['BARBERO', 'CLIENTE'] as const).map((rol) => [ruta, rol] as const)))(
    '%s: %s → 403 ACCESO_DENEGADO auditado, sin crear nada',
    async (ruta, rol) => {
      const antes = await servicios();
      const r = await pedir(ruta, tokens[rol]).expect(403);
      expect(r.body.codigo).toBe('ACCESO_DENEGADO');
      expect(await servicios()).toBe(antes);
      const denegadas = (await filasDe('audit_log', tenantId)).filter(
        (f) => f.action === 'ACCESO_DENEGADO_ROL' && f.resource === 'operacion:GESTIONAR_SERVICIOS',
      );
      expect(denegadas.length).toBeGreaterThan(0);
    },
  );

  it.each(RUTAS)('%s: sin sesión o con el token de la plataforma → 401', async (ruta) => {
    await pedir(ruta, null).expect(401);
    await pedir(ruta, plataforma).expect(401);
  });
});
