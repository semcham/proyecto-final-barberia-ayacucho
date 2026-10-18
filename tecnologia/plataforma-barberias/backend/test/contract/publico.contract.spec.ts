import { type AppDePrueba, crearApp } from '../helpers/app';
import { erroresDeContrato002 } from '../helpers/contrato';
import { sembrarUsuario } from '../helpers/fixtures';
import { type BarberiaParaReservar, barberiaParaReservar, fechaEnDias } from '../helpers/reservas';
import { sesionCliente, tokenPara } from '../helpers/sesiones';
import { cerrarPools } from '../helpers/test-db';

// T065 · Contrato (specs/002-catalogo-citas-cliente/contracts/openapi.yaml) de GET /publico/{slug},
// GET /publico/{slug}/horarios y GET /horarios. Las respuestas públicas tienen additionalProperties: false:
// cualquier campo de más (un dato privado) rompe el contrato.

describe('Contrato 002: catálogo y horarios', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;
  let tokenCliente: string;
  const fecha = fechaEnDias(2);

  beforeAll(async () => {
    prueba = await crearApp();
    e = await barberiaParaReservar();
    tokenCliente = (await sesionCliente(e.barberia.tenantId)).token;
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('GET /publico/{slug}: 200 con CatalogoPublico y 404 BARBERIA_NO_DISPONIBLE', async () => {
    const ok = await prueba.agente.get(`/api/v1/publico/${e.barberia.slug}`).expect(200);
    expect(erroresDeContrato002('/publico/{slug}', 'get', 200, ok.body)).toEqual([]);
    expect(ok.body.servicios).toHaveLength(1);
    expect(ok.body.barberos).toHaveLength(2);

    const noHay = await prueba.agente.get('/api/v1/publico/no-existe').expect(404);
    expect(erroresDeContrato002('/publico/{slug}', 'get', 404, noHay.body)).toEqual([]);
    expect(noHay.body.codigo).toBe('BARBERIA_NO_DISPONIBLE');
  });

  it('GET /publico/{slug}/horarios: 200 con HorariosLibres, 404 y 400', async () => {
    const ruta = `/api/v1/publico/${e.barberia.slug}/horarios`;
    const ok = await prueba.agente.get(`${ruta}?servicio=${e.servicioId}&fecha=${fecha}`).expect(200);
    expect(erroresDeContrato002('/publico/{slug}/horarios', 'get', 200, ok.body)).toEqual([]);
    expect(ok.body.horas.length).toBeGreaterThan(0);

    const noHay = await prueba.agente
      .get(`/api/v1/publico/no-existe/horarios?servicio=${e.servicioId}&fecha=${fecha}`)
      .expect(404);
    expect(erroresDeContrato002('/publico/{slug}/horarios', 'get', 404, noHay.body)).toEqual([]);

    for (const consulta of [
      `servicio=${e.servicioId}&fecha=2026-02-30`,
      `servicio=${e.servicioId}&fecha=20-10-2026`,
      `fecha=${fecha}`,
      `servicio=no-es-uuid&fecha=${fecha}`,
      `servicio=${e.servicioId}&fecha=${fecha}&barbero=no-es-uuid`,
    ]) {
      const malo = await prueba.agente.get(`${ruta}?${consulta}`).expect(400);
      expect(erroresDeContrato002('/publico/{slug}/horarios', 'get', 400, malo.body)).toEqual([]);
    }
  });

  it('GET /horarios: 200 (CLIENTE y PROPIETARIO), 400, 401 y 403 (BARBERO)', async () => {
    const consulta = `servicio=${e.servicioId}&fecha=${fecha}`;
    const cliente = await prueba.agente
      .get(`/api/v1/horarios?${consulta}`)
      .set({ Authorization: `Bearer ${tokenCliente}` })
      .expect(200);
    expect(erroresDeContrato002('/horarios', 'get', 200, cliente.body)).toEqual([]);

    const tokenPropietario = await tokenPara(e.barberia.tenantId, e.barberia.propietarioId, 'PROPIETARIO');
    await prueba.agente
      .get(`/api/v1/horarios?${consulta}`)
      .set({ Authorization: `Bearer ${tokenPropietario}` })
      .expect(200);

    const malo = await prueba.agente
      .get(`/api/v1/horarios?servicio=${e.servicioId}`)
      .set({ Authorization: `Bearer ${tokenCliente}` })
      .expect(400);
    expect(erroresDeContrato002('/horarios', 'get', 400, malo.body)).toEqual([]);

    const sinToken = await prueba.agente.get(`/api/v1/horarios?${consulta}`).expect(401);
    expect(erroresDeContrato002('/horarios', 'get', 401, sinToken.body)).toEqual([]);

    const barbero = await sembrarUsuario({ tenantId: e.barberia.tenantId, rol: 'BARBERO', estado: 'ACTIVA' });
    const tokenBarbero = await tokenPara(e.barberia.tenantId, barbero.usuarioId, 'BARBERO');
    const prohibido = await prueba.agente
      .get(`/api/v1/horarios?${consulta}`)
      .set({ Authorization: `Bearer ${tokenBarbero}` })
      .expect(403);
    expect(erroresDeContrato002('/horarios', 'get', 403, prohibido.body)).toEqual([]);
  });
});
