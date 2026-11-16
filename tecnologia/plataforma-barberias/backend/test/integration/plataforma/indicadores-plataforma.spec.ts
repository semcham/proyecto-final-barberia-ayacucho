import { randomUUID } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { sembrarBarberia, sembrarCliente } from '../../helpers/fixtures';
import {
  borrarBarberiasEnBloque,
  consultasAuditadas,
  type EstadoSuscripcionSembrado,
  fijarEstados,
  pedirIndicadores,
  sembrarBarberiasEnBloque,
} from '../../helpers/indicadores';
import { tokenPara, tokenPlataformaPara } from '../../helpers/sesiones';
import { cerrarPools } from '../../helpers/test-db';

// T027 de 007 · US2-1, US2-4 a US2-6; FR-012 a FR-016; SC-004, SC-005. El administrador de la plataforma ve las
// barberías activas, suspendidas y por estado de la suscripción, con la hora del cálculo, sin ningún dato de una
// barbería ni de una persona. La base de pruebas es compartida, así que los conteos se comparan por diferencia: antes
// y después de sembrar. Fase 2b: sin las vistas de conteo, las citas por mes y los usuarios no aparecen.

interface Indicadores {
  calculadoEn: string;
  barberias: {
    activas: number;
    suspendidas: number;
    porEstadoDeSuscripcion: { estado: string; barberias: number }[];
  };
  citasPorMes?: unknown;
  usuarios?: unknown;
}

const LIMITE_MS = 3000;
const BARBERIAS_DE_VOLUMEN = 500;

function porEstado(i: Indicadores): Record<string, number> {
  return Object.fromEntries(i.barberias.porEstadoDeSuscripcion.map((e) => [e.estado, e.barberias]));
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

  it('dice la hora del cálculo; sin las vistas de conteo (fase 2b) no trae citas por mes ni usuarios', async () => {
    const inicio = Date.now();
    const indicadores = await consultar();
    const calculado = Date.parse(indicadores.calculadoEn);
    expect(calculado).not.toBeNaN();
    expect(calculado).toBeGreaterThanOrEqual(inicio - 1000);
    expect(calculado).toBeLessThanOrEqual(Date.now() + 1000);
    expect(indicadores).not.toHaveProperty('citasPorMes');
    expect(indicadores).not.toHaveProperty('usuarios');
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
});
