import { type AppDePrueba, crearApp } from '../../helpers/app';
import { erroresDeContrato005 } from '../../helpers/contrato';
import { sembrarCliente } from '../../helpers/fixtures';
import { pedirReportes, porDiaDeSemana, sembrarCitaDeReporte } from '../../helpers/reportes';
import { type BarberiaParaReservar, barberiaParaReservar } from '../../helpers/reservas';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T015 de 005 · US2-1 a US2-6, FR-020 a FR-024 y FR-026: los tres reportes de un período dan exactamente los conteos
// esperados de un conjunto de citas sembradas, también en los bordes del período en la zona de Lima; un período
// inválido es 422 con el campo; uno sin citas da las tablas en cero; ningún dato de clientes; y responden igual con la
// suscripción vencida (lecturas sin restricción, 003) y sin proveedor de IA o con él caído (FR-026).
//
// Período: noviembre de 2026 en America/Lima. El 2026-11-01 es domingo (ISODOW 7) y el 2026-11-30, lunes (1).

const NOVIEMBRE = { desde: '2026-11-01', hasta: '2026-11-30' };

const CLIENTE = { nombre: 'Rocío Ñahui Prueba', correo: 'rocio.reportes@prueba.pe', telefono: '987654321' };

interface Sembrado {
  e: BarberiaParaReservar;
  token: string;
}

/**
 * Nueve citas dentro del período y dos justo fuera. Luis (barbero 1) y Ana (barbero 2). "Corte antiguo" es el nombre
 * que tenía el servicio al reservarse una de ellas: el servicio se renombró después a "Corte clásico".
 */
async function sembrar(): Promise<Sembrado> {
  const e = await barberiaParaReservar();
  const tenantId = e.barberia.tenantId;
  const seed = poolDe('seed');
  await seed.query(`UPDATE barber SET display_name = 'Luis' WHERE id = $1`, [e.barberoId]);
  await seed.query(`UPDATE barber SET display_name = 'Ana' WHERE id = $1`, [e.otroBarberoId]);
  await seed.query(`UPDATE service SET name = 'Corte clásico' WHERE id = $1`, [e.servicioId]);
  const { clienteId } = await sembrarCliente({ tenantId, ...CLIENTE });
  const cita = (
    barberoId: string,
    inicio: string,
    estado: Parameters<typeof sembrarCitaDeReporte>[0]['estado'],
    servicio?: string,
    tardia?: boolean,
  ) =>
    sembrarCitaDeReporte({
      tenantId,
      barberoId,
      servicioId: e.servicioId,
      clienteId,
      inicio,
      estado,
      servicio,
      tardia,
    });
  const luis = e.barberoId;
  const ana = e.otroBarberoId;
  // Bordes: la primera hora del primer día y el último minuto del último día entran.
  await cita(luis, '2026-11-01T00:00:00-05:00', 'COMPLETADA');
  await cita(ana, '2026-11-30T23:59:00-05:00', 'CONFIRMADA', 'Barba');
  await cita(luis, '2026-11-10T10:00:00-05:00', 'COMPLETADA');
  await cita(luis, '2026-11-10T11:00:00-05:00', 'PENDIENTE');
  await cita(ana, '2026-11-11T10:00:00-05:00', 'NO_ASISTIO', 'Barba');
  await cita(luis, '2026-11-12T10:00:00-05:00', 'CANCELADA', 'Corte clásico', true);
  await cita(ana, '2026-11-12T11:00:00-05:00', 'CANCELADA', 'Tinte');
  await cita(ana, '2026-11-13T10:00:00-05:00', 'COMPLETADA', 'Corte antiguo');
  await cita(luis, '2026-11-14T10:00:00-05:00', 'COMPLETADA', 'Barba');
  // Fuera: las 00:00 del día siguiente al fin y el último minuto del día anterior al inicio.
  await cita(luis, '2026-12-01T00:00:00-05:00', 'COMPLETADA');
  await cita(ana, '2026-10-31T23:59:00-05:00', 'COMPLETADA');
  const token = await tokenPara(tenantId, e.barberia.propietarioId, 'PROPIETARIO');
  return { e, token };
}

const ESPERADO_NOVIEMBRE = {
  periodo: { ...NOVIEMBRE, zonaHoraria: 'America/Lima' },
  citas: {
    total: 9,
    pendientes: 1,
    confirmadas: 1,
    completadas: 4,
    noAsistio: 1,
    canceladas: 2,
    canceladasTardias: 1,
  },
  // Sin las canceladas (la de "Tinte" no aparece); empate a 3 resuelto por nombre; el nombre de la cita, no el actual.
  serviciosMasSolicitados: [
    { nombre: 'Barba', citas: 3 },
    { nombre: 'Corte clásico', citas: 3 },
    { nombre: 'Corte antiguo', citas: 1 },
  ],
  actividad: {
    porBarbero: [
      { barbero: 'Luis', citas: 5 },
      { barbero: 'Ana', citas: 4 },
    ],
    porDiaDeSemana: porDiaDeSemana({ 1: 1, 2: 2, 3: 1, 4: 2, 5: 1, 6: 1, 7: 1 }),
    cancelacionesTardias: 1,
    noAsistencias: 1,
  },
};

describe('T015 · GET /reportes: los tres reportes del período (US2)', () => {
  let prueba: AppDePrueba;
  let s: Sembrado;

  beforeAll(async () => {
    prueba = await crearApp();
    s = await sembrar();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('da exactamente los conteos esperados, con los bordes del período en la zona de Lima', async () => {
    const { body } = await pedirReportes(prueba, s.token, NOVIEMBRE).expect(200);
    expect(body).toEqual(ESPERADO_NOVIEMBRE);
    expect(erroresDeContrato005('/reportes', 'get', 200, body)).toEqual([]);
  });

  it('la respuesta no tiene ningún dato de clientes (nombre, correo, teléfono ni id)', async () => {
    const { body } = await pedirReportes(prueba, s.token, NOVIEMBRE).expect(200);
    const texto = JSON.stringify(body);
    expect(texto).not.toContain('Rocío');
    expect(texto).not.toContain(CLIENTE.correo);
    expect(texto).not.toContain(CLIENTE.telefono);
    const { rows } = await poolDe('seed').query<{ id: string }>(
      'SELECT id FROM customer_profile WHERE tenant_id = $1',
      [s.e.barberia.tenantId],
    );
    for (const { id } of rows) expect(texto).not.toContain(id);
  });

  it('un solo día: el 2026-11-01 cuenta solo la cita de las 00:00', async () => {
    const { body } = await pedirReportes(prueba, s.token, {
      desde: '2026-11-01',
      hasta: '2026-11-01',
    }).expect(200);
    expect(body.citas).toMatchObject({ total: 1, completadas: 1 });
    expect(body.actividad.porDiaDeSemana).toEqual(porDiaDeSemana({ 7: 1 }));
  });

  it('un período sin citas responde 200 con las tablas en cero, no un error (US2-6)', async () => {
    const { body } = await pedirReportes(prueba, s.token, {
      desde: '2030-01-01',
      hasta: '2030-01-31',
    }).expect(200);
    expect(body).toEqual({
      periodo: { desde: '2030-01-01', hasta: '2030-01-31', zonaHoraria: 'America/Lima' },
      citas: {
        total: 0,
        pendientes: 0,
        confirmadas: 0,
        completadas: 0,
        noAsistio: 0,
        canceladas: 0,
        canceladasTardias: 0,
      },
      serviciosMasSolicitados: [],
      actividad: {
        porBarbero: [],
        porDiaDeSemana: porDiaDeSemana({}),
        cancelacionesTardias: 0,
        noAsistencias: 0,
      },
    });
  });

  it('366 días se aceptan; 367 → 422 VALIDACION con el campo hasta y un mensaje claro', async () => {
    await pedirReportes(prueba, s.token, { desde: '2028-01-01', hasta: '2028-12-31' }).expect(200);
    const { body } = await pedirReportes(prueba, s.token, {
      desde: '2026-01-01',
      hasta: '2027-01-02',
    }).expect(422);
    expect(body).toEqual({
      codigo: 'VALIDACION',
      mensaje: expect.stringMatching(/366 días/),
      detalles: [{ campo: 'hasta', problema: 'maximo_366_dias' }],
    });
    expect(erroresDeContrato005('/reportes', 'get', 422, body)).toEqual([]);
  });

  it.each([
    ['sin fechas', {}, 'desde', 'obligatorio'],
    ['sin la fecha de fin', { desde: '2026-11-01' }, 'hasta', 'obligatorio'],
    ['el inicio después del fin', { desde: '2026-11-30', hasta: '2026-11-01' }, 'desde', 'posterior_a_hasta'],
    ['una fecha imposible', { desde: '2026-02-30', hasta: '2026-03-01' }, 'desde', 'formato'],
    ['otro formato', { desde: '01/11/2026', hasta: '2026-11-30' }, 'desde', 'formato'],
  ])('%s → 422 con el campo a corregir', async (_caso, parametros, campo, problema) => {
    const { body } = await pedirReportes(prueba, s.token, parametros).expect(422);
    expect(body).toMatchObject({ codigo: 'VALIDACION', detalles: [{ campo, problema }] });
    expect(body.mensaje.length).toBeGreaterThan(10);
  });

  it('ninguna consulta escribe en appointment', async () => {
    const contar = async () =>
      (await poolDe('seed').query<{ n: number }>('SELECT count(*)::int AS n FROM appointment')).rows[0].n;
    const antes = await contar();
    await pedirReportes(prueba, s.token, NOVIEMBRE).expect(200);
    expect(await contar()).toBe(antes);
  });

  it('no depende del proveedor de IA: igual sin proveedor y con el proveedor falso caído (FR-026)', async () => {
    for (const entorno of [
      { IA_PROVEEDOR: 'ninguno' },
      { IA_PROVEEDOR: 'falso', IA_FALSO_MODO: 'caido' },
      { IA_PROVEEDOR: 'falso', IA_FALSO_MODO: 'lento' },
    ]) {
      const otra = await crearApp({ entorno });
      try {
        const { body } = await pedirReportes(otra, s.token, NOVIEMBRE).expect(200);
        expect(body).toEqual(ESPERADO_NOVIEMBRE);
      } finally {
        await otra.cerrar();
      }
    }
  });

  // Al final: deja la suscripción vencida.
  it('con la suscripción vencida responde igual: las lecturas no se restringen en ningún estado (003)', async () => {
    await poolDe('seed').query(
      `UPDATE subscription SET status = 'EXPIRED', grace_ends_at = NULL WHERE tenant_id = $1`,
      [s.e.barberia.tenantId],
    );
    const { body } = await pedirReportes(prueba, s.token, NOVIEMBRE).expect(200);
    expect(body).toEqual(ESPERADO_NOVIEMBRE);
  });
});
