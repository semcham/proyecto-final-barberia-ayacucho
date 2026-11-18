import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { ZonaHoraria } from '../../../src/shared/tiempo/zona-horaria';
import {
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarServicio,
  sembrarUsuario,
} from '../../helpers/fixtures';
import {
  borrarBarberiasEnBloque,
  borrarCitasEnBloque,
  consultasAuditadas,
  type EstadoSuscripcionSembrado,
  fijarEstados,
  fijarRegistroDeCita,
  pedirIndicadores,
  sembrarBarberiasEnBloque,
  sembrarCitasEnBloque,
} from '../../helpers/indicadores';
import { tokenPara, tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T027 y T045 de 007 · US2-1 a US2-6; FR-012 a FR-016; SC-004, SC-005. El administrador de la plataforma ve las
// barberías activas, suspendidas y por estado de la suscripción, las citas por mes de los últimos 12 meses (en Lima) y
// los usuarios por tipo, con la hora del cálculo, sin ningún dato de una barbería ni de una persona. La base de pruebas
// es compartida, así que los conteos se comparan por diferencia: antes y después de sembrar.

interface CitasDelMes {
  mes: string;
  total: number;
  porEstado: { estado: string; citas: number }[];
}

interface Usuarios {
  personal: number;
  clientes: number;
}

interface Indicadores {
  calculadoEn: string;
  barberias: {
    activas: number;
    suspendidas: number;
    porEstadoDeSuscripcion: { estado: string; barberias: number }[];
  };
  citasPorMes?: CitasDelMes[];
  usuarios?: Usuarios;
}

type EstadoCita = 'PENDIENTE' | 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO' | 'CANCELADA';

const LIMITE_MS = 3000;
const BARBERIAS_DE_VOLUMEN = 500;
const CITAS_DE_VOLUMEN = 52_000;

function porEstado(i: Indicadores): Record<string, number> {
  return Object.fromEntries(i.barberias.porEstadoDeSuscripcion.map((e) => [e.estado, e.barberias]));
}

/** Mes `YYYY-MM` de Lima, desplazado `meses` desde el actual. */
function mesDeLima(meses: number): string {
  const hoy = ZonaHoraria.LIMA.fechaDe(new Date());
  const fecha = new Date(Date.UTC(hoy.anio, hoy.mes - 1 + meses, 1));
  return `${fecha.getUTCFullYear()}-${String(fecha.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Último día (`DD`) de un mes `YYYY-MM`. */
function ultimoDia(mes: string): string {
  const [anio, numero] = mes.split('-').map(Number);
  return String(new Date(Date.UTC(anio, numero, 0)).getUTCDate()).padStart(2, '0');
}

/** Por mes: lo que cambió entre dos consultas (el total y cada estado), solo los meses que cambiaron. */
function diferenciaPorMes(antes: Indicadores, despues: Indicadores): Record<string, Record<string, number>> {
  const aMapa = (i: Indicadores) =>
    new Map(
      (i.citasPorMes ?? []).map((m) => [
        m.mes,
        { total: m.total, ...Object.fromEntries(m.porEstado.map((e) => [e.estado, e.citas])) } as Record<
          string,
          number
        >,
      ]),
    );
  const previo = aMapa(antes);
  const resultado: Record<string, Record<string, number>> = {};
  for (const [mes, valores] of aMapa(despues)) {
    const cambios = Object.fromEntries(
      Object.entries(valores)
        .map(([clave, n]) => [clave, n - (previo.get(mes)?.[clave] ?? 0)] as const)
        .filter(([, n]) => n !== 0),
    );
    if (Object.keys(cambios).length > 0) resultado[mes] = cambios;
  }
  return resultado;
}

/** Servicio, barbero y cliente de una barbería, para sembrar citas. */
async function agendaDe(tenantId: string) {
  const { servicioId } = await sembrarServicio({ tenantId });
  const { barberoId } = await sembrarBarbero({ tenantId, servicios: [servicioId] });
  const { clienteId } = await sembrarCliente({ tenantId });
  return { servicioId, barberoId, clienteId };
}

describe('T027 · Indicadores de la plataforma: barberías por estado (US2, FR-012 a FR-016)', () => {
  let prueba: AppDePrueba;
  let admin: { adminId: string; token: string };

  beforeAll(async () => {
    prueba = await crearApp();
    const adminId = randomUUID();
    admin = { adminId, token: (await tokenPlataformaPara(adminId)).token };
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  const consultar = async (): Promise<Indicadores> =>
    (await pedirIndicadores(prueba, admin.token).expect(200)).body as Indicadores;

  it('cuenta exactamente las barberías sembradas: activas, suspendidas y por estado de la suscripción', async () => {
    const antes = await consultar();
    const casos: [EstadoSuscripcionSembrado, 'ACTIVA' | 'SUSPENDIDA'][] = [
      ['TRIAL', 'ACTIVA'],
      ['TRIAL', 'ACTIVA'],
      ['ACTIVE', 'ACTIVA'],
      ['PAST_DUE', 'ACTIVA'],
      ['EXPIRED', 'ACTIVA'],
      ['SUSPENDED', 'ACTIVA'],
      ['CANCELLED', 'ACTIVA'],
      // Suspendida por el administrador: no cuenta como activa aunque su suscripción deje operar.
      ['ACTIVE', 'SUSPENDIDA'],
    ];
    for (const [suscripcion, barberia] of casos) {
      const { tenantId } = await sembrarBarberia();
      await fijarEstados(tenantId, suscripcion, barberia);
    }
    const despues = await consultar();

    // Activas: no suspendidas, con TRIAL, ACTIVE o PAST_DUE (research R04): 2 + 1 + 1.
    expect(despues.barberias.activas - antes.barberias.activas).toBe(4);
    expect(despues.barberias.suspendidas - antes.barberias.suspendidas).toBe(1);
    const diferencia = Object.fromEntries(
      Object.entries(porEstado(despues)).map(([estado, n]) => [estado, n - (porEstado(antes)[estado] ?? 0)]),
    );
    expect(diferencia).toMatchObject({
      TRIAL: 2,
      ACTIVE: 2,
      PAST_DUE: 1,
      EXPIRED: 1,
      SUSPENDED: 1,
      CANCELLED: 1,
    });
    // Los seis estados de la suscripción siempre aparecen, aunque sea en cero.
    expect(Object.keys(porEstado(despues))).toEqual(
      expect.arrayContaining(['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'SUSPENDED', 'CANCELLED']),
    );
  });

  it('solo números: ningún id, nombre ni enlace de una barbería, ni correos o teléfonos', async () => {
    const b = await sembrarBarberia({ nombre: 'Barbería Marcador Indicadores' });
    const cliente = await sembrarCliente({ tenantId: b.tenantId, telefono: '987123456' });
    const respuesta = await pedirIndicadores(prueba, admin.token).expect(200);
    const texto = JSON.stringify(respuesta.body);
    for (const dato of [
      b.tenantId,
      b.slug,
      'Marcador Indicadores',
      b.correo,
      cliente.correo as string,
      '987123456',
    ]) {
      expect(texto).not.toContain(dato);
    }
    // Ningún uuid en el cuerpo.
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(texto).not.toMatch(/@/);
  });

  // T045 de 007 · Esta aserción era propia de la fase 2b ("sin las vistas de conteo no trae citas por mes ni
  // usuarios"); con las vistas de la fase 2c, las dos secciones vienen siempre.
  it('dice la hora del cálculo y, con las vistas de conteo (fase 2c), trae citas por mes y usuarios', async () => {
    const inicio = Date.now();
    const indicadores = await consultar();
    const calculado = Date.parse(indicadores.calculadoEn);
    expect(calculado).not.toBeNaN();
    expect(calculado).toBeGreaterThanOrEqual(inicio - 1000);
    expect(calculado).toBeLessThanOrEqual(Date.now() + 1000);
    expect(indicadores).toHaveProperty('citasPorMes');
    expect(indicadores).toHaveProperty('usuarios');
  });

  describe('citas por mes (fase 2c, FR-016): los últimos 12 meses en Lima, con ceros y el borde del mes', () => {
    it('cuenta exactamente las citas sembradas por mes de registro y estado', async () => {
      const antes = await consultar();
      const meses = (antes.citasPorMes as CitasDelMes[]).map((m) => m.mes);
      // Doce meses consecutivos, del más antiguo al actual de Lima, aunque alguno esté en cero.
      expect(meses).toEqual(Array.from({ length: 12 }, (_, i) => mesDeLima(i - 11)));

      const b = await sembrarBarberia();
      const agenda = await agendaDe(b.tenantId);
      const mes0 = mesDeLima(0);
      const mesAnterior = mesDeLima(-1);
      const casos: { estado: EstadoCita; registradaEn: string; horasDespues: number }[] = [
        // Ahora: mes actual.
        { estado: 'CONFIRMADA', registradaEn: new Date().toISOString(), horasDespues: 50 },
        // Borde: a las 00:00 del día 1 del mes actual, hora de Lima → mes actual.
        { estado: 'CANCELADA', registradaEn: `${mes0}-01T00:00:00-05:00`, horasDespues: 51 },
        // Borde: a las 23:59 del último día del mes anterior, hora de Lima (ya es el día 1 en UTC) → mes anterior.
        {
          estado: 'COMPLETADA',
          registradaEn: `${mesAnterior}-${ultimoDia(mesAnterior)}T23:59:00-05:00`,
          horasDespues: 52,
        },
        // Hace 11 meses: el más antiguo de la ventana.
        { estado: 'NO_ASISTIO', registradaEn: `${mesDeLima(-11)}-15T12:00:00-05:00`, horasDespues: 53 },
        // Hace 12 meses: fuera de la ventana, no cuenta.
        { estado: 'COMPLETADA', registradaEn: `${mesDeLima(-12)}-15T12:00:00-05:00`, horasDespues: 54 },
      ];
      for (const caso of casos) {
        const citaId = await sembrarCita({
          tenantId: b.tenantId,
          ...agenda,
          inicio: new Date(Date.now() + caso.horasDespues * 3600_000),
          estado: caso.estado,
        });
        await fijarRegistroDeCita(citaId, caso.registradaEn);
      }

      const despues = await consultar();
      expect(diferenciaPorMes(antes, despues)).toEqual({
        [mes0]: { total: 2, CONFIRMADA: 1, CANCELADA: 1 },
        [mesAnterior]: { total: 1, COMPLETADA: 1 },
        [mesDeLima(-11)]: { total: 1, NO_ASISTIO: 1 },
      });
      // Cada mes: el total es la suma de sus estados.
      for (const mes of despues.citasPorMes as CitasDelMes[]) {
        expect(mes.porEstado.reduce((suma, e) => suma + e.citas, 0)).toBe(mes.total);
      }
    });
  });

  it('usuarios (fase 2c): personal y clientes con membresía activa, exactos', async () => {
    const antes = (await consultar()).usuarios as Usuarios;
    const b = await sembrarBarberia(); // +1 personal: el propietario
    await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'ACTIVA' }); // +1 personal
    await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'PENDIENTE' }); // no cuenta
    await sembrarUsuario({ tenantId: b.tenantId, rol: 'BARBERO', estado: 'DESACTIVADA' }); // no cuenta
    await sembrarCliente({ tenantId: b.tenantId }); // +1 cliente
    await sembrarCliente({ tenantId: b.tenantId }); // +1 cliente
    await sembrarCliente({ tenantId: b.tenantId, conCuenta: false }); // presencial, sin cuenta ni membresía
    const despues = (await consultar()).usuarios as Usuarios;
    expect({
      personal: despues.personal - antes.personal,
      clientes: despues.clientes - antes.clientes,
    }).toEqual({ personal: 2, clientes: 2 });
  });

  it('con un token de barbería → 401; sin token → 401', async () => {
    const b = await sembrarBarberia();
    const propietario = await tokenPara(b.tenantId, b.propietarioId, 'PROPIETARIO');
    await pedirIndicadores(prueba, propietario).expect(401);
    await pedirIndicadores(prueba, null).expect(401);
  });

  it('cada consulta deja una fila ADMIN_INDICADORES_CONSULTADOS en platform_audit_log', async () => {
    const adminId = randomUUID();
    const { token } = await tokenPlataformaPara(adminId);
    await pedirIndicadores(prueba, token).expect(200);
    await pedirIndicadores(prueba, token).expect(200);
    const filas = await consultasAuditadas(adminId);
    expect(filas).toHaveLength(2);
    for (const fila of filas) expect(fila).toMatchObject({ admin_id: adminId, result: 'PERMITIDO' });
  });

  it(`responde en ${LIMITE_MS} ms o menos con ${BARBERIAS_DE_VOLUMEN} barberías más (SC-005)`, async () => {
    const ids = await sembrarBarberiasEnBloque(BARBERIAS_DE_VOLUMEN);
    try {
      const antes = await consultar();
      const inicio = performance.now();
      const despues = await consultar();
      const duracion = performance.now() - inicio;
      expect(despues.barberias.activas).toBe(antes.barberias.activas);
      expect(duracion).toBeLessThanOrEqual(LIMITE_MS);
    } finally {
      await borrarBarberiasEnBloque(ids);
    }
  });

  // T045 de 007 · SC-005 ya con las vistas de conteo: el volumen de `escalado` (reportes-periodo de 005): una barbería
  // con 22 000 citas en un año y 10 barberías más con 3 000 cada una, es decir, 52 000 citas.
  it(`responde en ${LIMITE_MS} ms o menos con el volumen de escalado: ${CITAS_DE_VOLUMEN} citas (SC-005, fase 2c)`, async () => {
    const marcadores: string[] = [];
    try {
      const reparto = [22_000, ...Array.from({ length: 10 }, () => 3_000)];
      for (const cantidad of reparto) {
        const b = await sembrarBarberia();
        marcadores.push(
          await sembrarCitasEnBloque({ tenantId: b.tenantId, ...(await agendaDe(b.tenantId)), cantidad }),
        );
      }
      expect(reparto.reduce((x, y) => x + y, 0)).toBe(CITAS_DE_VOLUMEN);
      await consultar();
      const inicio = performance.now();
      const indicadores = await consultar();
      const duracion = performance.now() - inicio;
      const total = (indicadores.citasPorMes as CitasDelMes[]).reduce((suma, m) => suma + m.total, 0);
      // Las registradas antes del primer día del mes más antiguo de la ventana quedan fuera (unas 8 de cada 100).
      expect(total).toBeGreaterThanOrEqual(Math.floor(CITAS_DE_VOLUMEN * 0.85));
      expect(duracion).toBeLessThanOrEqual(LIMITE_MS);
    } finally {
      for (const marcador of marcadores) await borrarCitasEnBloque(marcador);
    }
  });
});
