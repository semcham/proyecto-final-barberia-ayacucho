import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarCliente } from '../../helpers/fixtures';
import { pedirReportes, sembrarCitaDeReporte } from '../../helpers/reportes';
import { type BarberiaParaReservar, barberiaParaReservar } from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T016 de 005 · PR09, FR-025 y SC-006: el propietario de A solo ve las cifras de A, aunque la solicitud traiga un
// tenant, un slug o una cabecera de B. Un intento explícito de indicar la barbería se rechaza (400, como en todo el
// sistema, T044 de 001); un parámetro desconocido también (lista blanca del ValidationPipe). Nada de B en la respuesta.

const PERIODO = { desde: '2026-11-01', hasta: '2026-11-30' };

interface Barberia {
  e: BarberiaParaReservar;
  token: string;
}

/** Una barbería con `citas` citas completadas del servicio y barbero con nombres propios de la barbería. */
async function sembrar(nombre: string, citas: number): Promise<Barberia> {
  const e = await barberiaParaReservar();
  const tenantId = e.barberia.tenantId;
  await poolDe('seed').query(`UPDATE barber SET display_name = $2 WHERE id = $1`, [
    e.barberoId,
    `Barbero ${nombre}`,
  ]);
  const { clienteId } = await sembrarCliente({ tenantId });
  for (let i = 0; i < citas; i++) {
    await sembrarCitaDeReporte({
      tenantId,
      barberoId: e.barberoId,
      servicioId: e.servicioId,
      clienteId,
      inicio: `2026-11-${String(2 + i).padStart(2, '0')}T10:00:00-05:00`,
      estado: 'COMPLETADA',
      servicio: `Servicio ${nombre}`,
    });
  }
  return { e, token: await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO') };
}

describe('T016 · Aislamiento de los reportes entre barberías (PR09)', () => {
  let prueba: AppDePrueba;
  let a: Barberia;
  let b: Barberia;

  beforeAll(async () => {
    prueba = await crearApp();
    a = await sembrar('A', 2);
    b = await sembrar('B', 5);
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const sinNadaDeB = (cuerpo: unknown) => {
    const texto = JSON.stringify(cuerpo);
    expect(texto).not.toContain('Servicio B');
    expect(texto).not.toContain('Barbero B');
    expect(texto).not.toContain(b.e.barberia.tenantId);
    expect(texto).not.toContain(b.e.barberia.slug);
  };

  it('el propietario de A ve solo las cifras de A, y el de B solo las de B', async () => {
    const deA = (await pedirReportes(prueba, a.token, PERIODO).expect(200)).body;
    expect(deA.citas.total).toBe(2);
    expect(deA.serviciosMasSolicitados).toEqual([{ nombre: 'Servicio A', citas: 2 }]);
    expect(deA.actividad.porBarbero).toEqual([{ barbero: 'Barbero A', citas: 2 }]);
    sinNadaDeB(deA);
    const deB = (await pedirReportes(prueba, b.token, PERIODO).expect(200)).body;
    expect(deB.citas.total).toBe(5);
  });

  it.each([
    ['tenantId de B en la consulta', () => ({ ...PERIODO, tenantId: b.e.barberia.tenantId })],
    ['barberiaId de B en la consulta', () => ({ ...PERIODO, barberiaId: b.e.barberia.tenantId })],
    ['tenant de B en la consulta', () => ({ ...PERIODO, tenant: b.e.barberia.tenantId })],
    ['slug de B en la consulta', () => ({ ...PERIODO, slug: b.e.barberia.slug })],
  ])('%s → 400, sin ninguna cifra', async (_caso, parametros) => {
    const { body } = await pedirReportes(prueba, a.token, parametros()).expect(400);
    expect(body.codigo).toBe('VALIDACION');
    expect(body.citas).toBeUndefined();
    sinNadaDeB(body);
  });

  it('la cabecera X-Tenant-Id de B → 400, sin cifras, y queda auditado en A', async () => {
    const { body } = await pedirReportes(prueba, a.token, PERIODO, {
      'X-Tenant-Id': b.e.barberia.tenantId,
    }).expect(400);
    expect(body.citas).toBeUndefined();
    sinNadaDeB(body);
    const { rows } = await poolDe('seed').query(
      `SELECT action FROM audit_log WHERE tenant_id = $1 AND action = 'ACCESO_TENANT_AJENO'`,
      [a.e.barberia.tenantId],
    );
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it('otras cabeceras con datos de B se ignoran: las cifras siguen siendo las de A', async () => {
    const { body } = await pedirReportes(prueba, a.token, PERIODO, {
      'X-Barberia': b.e.barberia.slug,
      'X-Forwarded-Host': `${b.e.barberia.slug}.barberias.local`,
    }).expect(200);
    expect(body.citas.total).toBe(2);
    sinNadaDeB(body);
  });
});
