import { type AppDePrueba, crearApp } from '../../helpers/app';
import { pagoEnRevision, revisar } from '../../helpers/comprobantes';
import { sembrarPago } from '../../helpers/fixtures';
import { barberiaEnPrueba } from '../../helpers/pagos';
import { tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T085 · Historial de pagos del propietario (RF25, HU20; FR-025): del más reciente al más antiguo, con plan,
// importe, medio, estado, motivo y marca; el número de operación solo con sus últimos 4 caracteres; paginado de
// a 20; nunca un pago de otra barbería ni datos de tarjeta, cuentas o comprobantes más allá del estado.

const seed = () => poolDe('seed');
const CAMPOS_DEL_CONTRATO = [
  'aprobadoEn',
  'creadoEn',
  'estado',
  'id',
  'importeCentimos',
  'marca',
  'medio',
  'moneda',
  'motivoActivacion',
  'motivoRechazo',
  'numeroOperacionFinal',
  'periodo',
  'plan',
].sort();

describe('Historial de pagos (T085)', () => {
  let prueba: AppDePrueba;

  beforeAll(async () => {
    prueba = await crearApp();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const historial = (token: string, pagina?: number | string) =>
    prueba.agente
      .get(`/api/v1/suscripcion/pagos${pagina === undefined ? '' : `?pagina=${pagina}`}`)
      .set('Authorization', `Bearer ${token}`);

  /** Pagos sembrados con una hora de creación conocida (para el orden). */
  async function sembrar(b: { tenantId: string; suscripcionId: string }, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const { pagoId } = await sembrarPago({
        tenantId: b.tenantId,
        suscripcionId: b.suscripcionId,
        estado: 'ANULADO',
      });
      await seed().query('UPDATE payment SET created_at = $2 WHERE id = $1', [
        pagoId,
        new Date(Date.UTC(2026, 9, 1, 12, 0, i)),
      ]);
      ids.push(pagoId);
    }
    return ids;
  }

  it('del más reciente al más antiguo, con los campos del contrato y nada más', async () => {
    const b = await barberiaEnPrueba();
    const { token } = await tokenPlataformaPara();
    // Un rechazado (con motivo), un aprobado con período y un duplicado.
    const rechazado = await pagoEnRevision(prueba, b.token);
    await revisar(prueba, token, b.tenantId, rechazado.pagoId, {
      resultado: 'RECHAZADO',
      motivo: 'El voucher no se lee',
    }).expect(200);
    const aprobado = await pagoEnRevision(prueba, b.token);
    await revisar(prueba, token, b.tenantId, aprobado.pagoId, {
      resultado: 'APROBADO',
      importeTransferidoCentimos: 4900,
    }).expect(200);
    const { pagoId: duplicado } = await sembrarPago({
      tenantId: b.tenantId,
      suscripcionId: b.suscripcionId,
      estado: 'APROBADO',
    });
    await seed().query(
      `UPDATE payment SET review = 'DUPLICADO', created_at = now() + interval '1 second' WHERE id = $1`,
      [duplicado],
    );

    const { body } = await historial(b.token).expect(200);
    expect(Object.keys(body).sort()).toEqual(['pagos', 'total']);
    expect(body.total).toBe(3);
    expect(body.pagos.map((p: { id: string }) => p.id)).toEqual([
      duplicado,
      aprobado.pagoId,
      rechazado.pagoId,
    ]);
    for (const pago of body.pagos) expect(Object.keys(pago).sort()).toEqual(CAMPOS_DEL_CONTRATO);

    const [dup, apr, rec] = body.pagos;
    expect(dup).toMatchObject({ estado: 'APROBADO', marca: 'DUPLICADO', medio: 'YAPE', periodo: null });
    expect(apr).toMatchObject({
      estado: 'APROBADO',
      medio: 'TRANSFERENCIA',
      importeCentimos: 4900,
      moneda: 'PEN',
      plan: { nombre: 'Básico' },
      numeroOperacionFinal: aprobado.numero.slice(-4),
      periodo: { iniciaEn: expect.any(String), terminaEn: expect.any(String) },
      motivoRechazo: null,
    });
    expect(rec).toMatchObject({ estado: 'RECHAZADO', motivoRechazo: 'El voucher no se lee', periodo: null });

    // Ni el número completo, ni la referencia, ni datos de la cuenta, ni nada del comprobante.
    const texto = JSON.stringify(body);
    for (const prohibido of [
      aprobado.numero,
      rechazado.numero,
      aprobado.referencia,
      '00219100000000000000',
      '191-0000000',
    ]) {
      expect(texto).not.toContain(prohibido);
    }
    expect(texto).not.toMatch(/sha256|comprobante|content|cuenta|tarjeta|cci/i);
  });

  it('pagina de a 20 y responde vacío más allá de la última página', async () => {
    const b = await barberiaEnPrueba();
    const ids = (await sembrar(b, 23)).reverse();
    const primera = await historial(b.token, 1).expect(200);
    expect(primera.body.total).toBe(23);
    expect(primera.body.pagos.map((p: { id: string }) => p.id)).toEqual(ids.slice(0, 20));
    const segunda = await historial(b.token, 2).expect(200);
    expect(segunda.body.pagos.map((p: { id: string }) => p.id)).toEqual(ids.slice(20));
    expect((await historial(b.token, 3).expect(200)).body).toEqual({ pagos: [], total: 23 });
    // Sin `pagina`, la primera.
    expect((await historial(b.token).expect(200)).body.pagos).toHaveLength(20);
  });

  it.each(['0', '-1', 'abc', '1.5', '501'])('una página inválida (%s) responde 400', async (pagina) => {
    const b = await barberiaEnPrueba();
    const r = await historial(b.token, pagina).expect(400);
    expect(r.body.codigo).toBe('VALIDACION');
  });

  it('una barbería sin pagos tiene el historial vacío', async () => {
    const b = await barberiaEnPrueba();
    expect((await historial(b.token).expect(200)).body).toEqual({ pagos: [], total: 0 });
  });

  it('nunca muestra un pago de otra barbería (PR09)', async () => {
    const a = await barberiaEnPrueba();
    const b = await barberiaEnPrueba();
    const deA = await sembrar(a, 3);
    const deB = await sembrar(b, 2);
    const historialA = (await historial(a.token).expect(200)).body;
    const historialB = (await historial(b.token).expect(200)).body;
    expect(historialA.total).toBe(3);
    expect(historialB.total).toBe(2);
    expect(historialA.pagos.map((p: { id: string }) => p.id).sort()).toEqual([...deA].sort());
    for (const id of deB) expect(JSON.stringify(historialA)).not.toContain(id);
    // Ni siquiera con el id de un pago ajeno en la consulta.
    expect((await historial(a.token, `1&pagoId=${deB[0]}`).expect(400)).body.codigo).toBe('VALIDACION');
  });
});
