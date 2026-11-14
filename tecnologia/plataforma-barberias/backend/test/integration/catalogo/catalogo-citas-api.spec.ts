import { CatalogoCitasApi } from '../../../src/modules/catalogo-citas';
import { TenantId, UnitOfWork } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarBarbero,
  sembrarCita,
  sembrarCliente,
  sembrarDisponibilidad,
  sembrarHorarioAtencion,
  sembrarServicio,
} from '../../helpers/fixtures';
import { tokenPara } from '../../helpers/sesiones';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T007 de 005 · FR-002, FR-030 y SC-001: la interfaz de solo lectura que M02 ofrece a M04 devuelve EXACTAMENTE lo
// mismo que las rutas que ya existen (el catálogo público de 002 y GET /horarios con sesión), solo datos públicos y
// solo de la barbería del tenant de la transacción. Las lecturas de agregados empiezan en cero y no ven otras
// barberías. Ninguna lectura escribe.

const DIA_MS = 24 * 60 * 60 * 1000;

interface Sembrado {
  barberia: BarberiaSembrada;
  corte: string;
  barba: string;
  inactivo: string;
  luis: string;
  ana: string;
  inactivoBarbero: string;
  clienteId: string;
  usuarioClienteId: string;
}

async function sembrar(): Promise<Sembrado> {
  const barberia = await sembrarBarberia();
  const { tenantId } = barberia;
  await sembrarHorarioAtencion(tenantId);
  const corte = (
    await sembrarServicio({ tenantId, nombre: 'Corte clásico', precio: '25.00', duracionMin: 30 })
  ).servicioId;
  const barba = (await sembrarServicio({ tenantId, nombre: 'Barba', precio: '15.50', duracionMin: 20 }))
    .servicioId;
  const inactivo = (await sembrarServicio({ tenantId, nombre: 'Tinte', activo: false })).servicioId;
  await poolDe('seed').query(`UPDATE service SET description = 'Con tijera y máquina' WHERE id = $1`, [
    corte,
  ]);
  const luis = (await sembrarBarbero({ tenantId, nombre: 'Luis', servicios: [corte, barba] })).barberoId;
  const ana = (await sembrarBarbero({ tenantId, nombre: 'Ana', servicios: [corte] })).barberoId;
  const inactivoBarbero = (
    await sembrarBarbero({ tenantId, nombre: 'Pedro', servicios: [corte], activo: false })
  ).barberoId;
  for (const barbero of [luis, ana]) await sembrarDisponibilidad(tenantId, barbero);
  const { clienteId, usuarioId } = await sembrarCliente({ tenantId });
  return {
    barberia,
    corte,
    barba,
    inactivo,
    luis,
    ana,
    inactivoBarbero,
    clienteId,
    usuarioClienteId: usuarioId as string,
  };
}

/** Un día hábil (lunes a viernes) de los próximos días, en la zona de Lima, como YYYY-MM-DD. */
function proximoDiaHabil(): string {
  for (let dias = 1; dias <= 7; dias++) {
    const instante = new Date(Date.now() + dias * DIA_MS);
    const semana = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', weekday: 'short' }).format(
      instante,
    );
    if (!['Sat', 'Sun'].includes(semana)) {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(instante);
    }
  }
  throw new Error('No hay un día hábil en la próxima semana');
}

describe('T007 · CatalogoCitasApi devuelve lo mismo que las rutas de 002, solo de la barbería del tenant', () => {
  let prueba: AppDePrueba;
  let api: CatalogoCitasApi;
  let uow: UnitOfWork;
  let a: Sembrado;
  let b: Sembrado;
  let tokenCliente: string;

  const enA = <T>(fn: () => Promise<T>) => uow.ejecutar(TenantId.de(a.barberia.tenantId), fn);

  beforeAll(async () => {
    prueba = await crearApp();
    api = prueba.app.get(CatalogoCitasApi, { strict: false });
    uow = prueba.app.get(UnitOfWork, { strict: false });
    a = await sembrar();
    b = await sembrar();
    tokenCliente = await tokenPara(a.barberia.tenantId, a.usuarioClienteId, 'CLIENTE');
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('serviciosActivos: los mismos del catálogo público (nombre, precio, duración y descripción), sin inactivos', async () => {
    const { body } = await prueba.agente.get(`/api/v1/publico/${a.barberia.slug}`).expect(200);
    const publicos = (
      body.servicios as {
        id: string;
        nombre: string;
        descripcion: string | null;
        precio: string;
        duracionMinutos: number;
      }[]
    ).map((s) => ({
      servicioId: s.id,
      nombre: s.nombre,
      descripcion: s.descripcion,
      precio: s.precio,
      duracionMinutos: s.duracionMinutos,
    }));
    const servicios = await enA(() => api.serviciosActivos());
    expect(servicios).toEqual(publicos);
    expect(servicios.map((s) => s.servicioId).sort()).toEqual([a.corte, a.barba].sort());
    expect(servicios.find((s) => s.servicioId === a.corte)?.descripcion).toBe('Con tijera y máquina');
    // Solo columnas públicas, sin estado ni fechas.
    for (const servicio of servicios) {
      expect(Object.keys(servicio).sort()).toEqual([
        'descripcion',
        'duracionMinutos',
        'nombre',
        'precio',
        'servicioId',
      ]);
    }
  });

  it('barberosQueOfrecen: los mismos del catálogo público para ese servicio, sin inactivos', async () => {
    const { body } = await prueba.agente.get(`/api/v1/publico/${a.barberia.slug}`).expect(200);
    const publicos = (body.barberos as { id: string; nombre: string; servicioIds: string[] }[])
      .filter((barbero) => barbero.servicioIds.includes(a.corte))
      .map((barbero) => ({ barberoId: barbero.id, nombre: barbero.nombre }));
    const barberos = await enA(() => api.barberosQueOfrecen(a.corte));
    expect(barberos).toEqual(publicos);
    expect(barberos.map((x) => x.nombre)).toEqual(['Ana', 'Luis']);
    expect(await enA(() => api.barberosQueOfrecen(a.barba))).toEqual([{ barberoId: a.luis, nombre: 'Luis' }]);
  });

  it('horariosLibres: lo mismo que GET /horarios con sesión, con y sin barbero', async () => {
    const fecha = proximoDiaHabil();
    for (const barberoId of [undefined, a.luis]) {
      const consulta = new URLSearchParams({
        servicio: a.corte,
        fecha,
        ...(barberoId ? { barbero: barberoId } : {}),
      });
      const { body } = await prueba.agente
        .get(`/api/v1/horarios?${consulta.toString()}`)
        .set('Authorization', `Bearer ${tokenCliente}`)
        .expect(200);
      const horarios = await enA(() => api.horariosLibres({ servicioId: a.corte, fecha, barberoId }));
      // calculadoEn es la hora del cálculo: lo único que cambia entre las dos llamadas.
      const sinHora = (vista: Record<string, unknown>) =>
        Object.fromEntries(Object.entries(vista).filter(([campo]) => campo !== 'calculadoEn'));
      expect(sinHora({ ...horarios })).toEqual(sinHora(body as Record<string, unknown>));
      expect(horarios.horas.length).toBeGreaterThan(0);
    }
  });

  it('nunca devuelve datos de otra barbería, aunque se pidan sus ids', async () => {
    const fecha = proximoDiaHabil();
    expect(await enA(() => api.barberosQueOfrecen(b.corte))).toEqual([]);
    const ajenos = await enA(() => api.horariosLibres({ servicioId: b.corte, fecha }));
    expect(ajenos.horas).toEqual([]);
    const conBarberoAjeno = await enA(() =>
      api.horariosLibres({ servicioId: a.corte, fecha, barberoId: b.luis }),
    );
    expect(conBarberoAjeno.horas).toEqual([]);
    const ids = (await enA(() => api.serviciosActivos())).map((s) => s.servicioId);
    expect(ids).not.toContain(b.corte);
    expect(ids).not.toContain(b.barba);
  });

  it('contextoDeLaBarberia: nombre, zona horaria y slug de la barbería pedida (fuera de una transacción)', async () => {
    const contexto = await api.contextoDeLaBarberia(TenantId.de(a.barberia.tenantId));
    expect(contexto).toEqual({
      nombre: expect.any(String),
      zonaHoraria: 'America/Lima',
      slug: a.barberia.slug,
    });
  });

  describe('lecturas de agregados', () => {
    const inicio = new Date('2030-01-01T05:00:00Z');
    const fin = new Date('2030-02-01T05:00:00Z');

    it('en un período sin citas, todo en cero (siete días de la semana, sin barberos ni servicios)', async () => {
      expect(await enA(() => api.conteosDeCitas(inicio, fin))).toEqual({
        total: 0,
        pendientes: 0,
        confirmadas: 0,
        completadas: 0,
        noAsistio: 0,
        canceladas: 0,
        canceladasTardias: 0,
      });
      expect(await enA(() => api.serviciosMasSolicitados(inicio, fin, 10))).toEqual([]);
      expect(await enA(() => api.actividad(inicio, fin))).toEqual({
        porBarbero: [],
        porDiaDeSemana: [1, 2, 3, 4, 5, 6, 7].map((dia) => ({ dia, citas: 0 })),
        cancelacionesTardias: 0,
        noAsistencias: 0,
      });
    });

    it('las citas de otra barbería en el período no cuentan', async () => {
      await sembrarCita({
        tenantId: b.barberia.tenantId,
        barberoId: b.luis,
        servicioId: b.corte,
        clienteId: b.clienteId,
        inicio: new Date('2030-01-10T15:00:00Z'),
        estado: 'COMPLETADA',
      });
      expect((await enA(() => api.conteosDeCitas(inicio, fin))).total).toBe(0);
      expect(await enA(() => api.serviciosMasSolicitados(inicio, fin, 10))).toEqual([]);
      expect((await enA(() => api.actividad(inicio, fin))).porBarbero).toEqual([]);
      // Con el tenant de B, la misma lectura sí la ve.
      const deB = await uow.ejecutar(TenantId.de(b.barberia.tenantId), () => api.conteosDeCitas(inicio, fin));
      expect(deB).toMatchObject({ total: 1, completadas: 1 });
    });
  });

  it('ninguna lectura escribe: citas, servicios, barberos y usuarios quedan iguales', async () => {
    const contar = async () => {
      const { rows } = await poolDe('seed').query<Record<string, number>>(
        `SELECT (SELECT count(*) FROM appointment)::int AS citas, (SELECT count(*) FROM service)::int AS servicios,
                (SELECT count(*) FROM barber)::int AS barberos, (SELECT count(*) FROM user_account)::int AS usuarios,
                (SELECT count(*) FROM audit_log)::int AS auditoria`,
      );
      return rows[0];
    };
    const antes = await contar();
    const fecha = proximoDiaHabil();
    await api.contextoDeLaBarberia(TenantId.de(a.barberia.tenantId));
    await enA(async () => {
      await api.serviciosActivos();
      await api.barberosQueOfrecen(a.corte);
      await api.horariosLibres({ servicioId: a.corte, fecha });
      await api.conteosDeCitas(new Date(Date.now() - 30 * DIA_MS), new Date());
      await api.serviciosMasSolicitados(new Date(Date.now() - 30 * DIA_MS), new Date(), 10);
      await api.actividad(new Date(Date.now() - 30 * DIA_MS), new Date());
    });
    expect(await contar()).toEqual(antes);
  });
});
