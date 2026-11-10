import { createHash } from 'node:crypto';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import { citaConEnlaces, ipUnica, solicitudDeEnlace } from '../../helpers/enlaces';
import { filasDe } from '../../helpers/fixtures';
import {
  type BarberiaParaReservar,
  barberiaParaReservar,
  fechaEnDias,
  horaLima,
} from '../../helpers/reservas';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T084 · Auditoría de las acciones por enlace (FR-035; data-model §6). Cada acción deja UNA entrada en el
// audit_log de la barbería de la cita, sin actor (no hay sesión) y sin el token:
//   confirmar → ASISTENCIA_CONFIRMADA_ENLACE (cita:<id>); cancelar → CITA_CANCELADA_ENLACE (cita:<id>);
//   reprogramar → CITA_REPROGRAMADA (cita:<id>;ENLACE;<antes>><después>).
// Un rechazo de enlace NO deja ninguna entrada en audit_log (no trae una barbería confiable): queda solo en
// action_link_attempt (hash de la IP) y en el registro de la aplicación con el código.

const SAL = process.env.ENLACES_SAL_IP as string;
const compacta = (instante: Date) =>
  instante
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\d{2}\.\d{3}Z$/, 'Z');

describe('Auditoría de las acciones por enlace (T084)', () => {
  let prueba: AppDePrueba;
  let e: BarberiaParaReservar;

  const entradas = async (accion: string) =>
    (await filasDe('audit_log', e.barberia.tenantId)).filter((f) => f.action === accion);

  beforeAll(async () => {
    prueba = await crearApp();
  });

  beforeEach(async () => {
    e = await barberiaParaReservar();
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('confirmar → una ASISTENCIA_CONFIRMADA_ENLACE sin actor ni token', async () => {
    const c = await citaConEnlaces(prueba, e, 300);
    const token = c.enlace('CONFIRMAR');
    await solicitudDeEnlace(prueba, 'confirmar', token, ipUnica()).expect(200);
    const filas = await entradas('ASISTENCIA_CONFIRMADA_ENLACE');
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({
      tenant_id: e.barberia.tenantId,
      actor_id: null,
      resource: `cita:${c.citaId}`,
      result: 'PERMITIDO',
    });
    expect(JSON.stringify(filas[0])).not.toContain(token.split('.')[0]);
  });

  it('cancelar → una CITA_CANCELADA_ENLACE (y no la CITA_CANCELADA de la sesión)', async () => {
    const c = await citaConEnlaces(prueba, e, 330);
    await solicitudDeEnlace(prueba, 'cancelar', c.enlace('CANCELAR'), ipUnica()).expect(200);
    expect(await entradas('CITA_CANCELADA_ENLACE')).toEqual([
      expect.objectContaining({ actor_id: null, resource: `cita:${c.citaId}`, result: 'PERMITIDO' }),
    ]);
    expect(await entradas('CITA_CANCELADA')).toEqual([]);
  });

  it('reprogramar → una CITA_REPROGRAMADA con la vía ENLACE y las dos horas', async () => {
    const c = await citaConEnlaces(prueba, e, 360);
    const destino = horaLima(fechaEnDias(4), '10:00');
    await solicitudDeEnlace(prueba, 'reprogramar', c.enlace('REPROGRAMAR'), ipUnica(), {
      inicio: destino,
    }).expect(200);
    expect(await entradas('CITA_REPROGRAMADA')).toEqual([
      expect.objectContaining({
        actor_id: null,
        resource: `cita:${c.citaId};ENLACE;${compacta(c.inicio)}>${compacta(new Date(destino))}`,
      }),
    ]);
  });

  it('un rechazo no deja ninguna entrada en audit_log: solo el hash de la IP en action_link_attempt', async () => {
    const c = await citaConEnlaces(prueba, e, 390);
    const ip = ipUnica();
    const antes = (await poolDe('seed').query('SELECT count(*)::int AS total FROM audit_log')).rows[0].total;
    const token = c.enlace('CONFIRMAR');
    await solicitudDeEnlace(prueba, 'confirmar', token, ip).expect(200);
    const tras = (await poolDe('seed').query('SELECT count(*)::int AS total FROM audit_log')).rows[0].total;
    // El segundo uso, de otra acción y alterado: tres rechazos.
    await solicitudDeEnlace(prueba, 'confirmar', token, ip).expect(410);
    await solicitudDeEnlace(prueba, 'cancelar', c.enlace('CONFIRMAR'), ip).expect(410);
    await solicitudDeEnlace(prueba, 'consultar', `${token}x`, ip).expect(410);
    const despues = (await poolDe('seed').query('SELECT count(*)::int AS total FROM audit_log')).rows[0]
      .total;
    expect(tras - antes).toBe(1);
    expect(despues).toBe(tras);
    const hash = createHash('sha256').update(SAL).update(ip).digest('hex');
    const { rows } = await poolDe('seed').query(
      'SELECT count(*)::int AS total FROM action_link_attempt WHERE ip_hash = $1',
      [hash],
    );
    expect(rows[0].total).toBe(3);
  });
});
