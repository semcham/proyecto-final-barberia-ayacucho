import { CatalogQuery } from '../../../src/modules/catalogo-citas/catalogo/application/ports/catalog-query';
import { FechaLocal, HorarioSemanal, TenantId, UnitOfWork } from '../../../src/shared';
import { type AppDePrueba, crearApp } from '../../helpers/app';
import {
  type BarberiaSembrada,
  sembrarBarberia,
  sembrarBarbero,
  sembrarBloqueo,
  sembrarDisponibilidad,
  sembrarHorarioAtencion,
  sembrarServicio,
} from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T032 · CatalogQuery (fase base de 002): lecturas del catálogo con el tenant del contexto.

const LUNES = FechaLocal.de('2026-10-19');
const m = (hora: string) => HorarioSemanal.minutosDe(hora);
const lima = (fecha: string, hora: string) => new Date(`${fecha}T${hora}:00-05:00`);

describe('CatalogQuery', () => {
  let prueba: AppDePrueba;
  let consulta: CatalogQuery;
  let uow: UnitOfWork;
  let a: BarberiaSembrada;
  let b: BarberiaSembrada;
  const ids: Record<string, string> = {};

  const enA = <T>(fn: () => Promise<T>) => uow.ejecutar(TenantId.de(a.tenantId), fn);

  beforeAll(async () => {
    prueba = await crearApp();
    consulta = prueba.app.get(CatalogQuery);
    uow = prueba.app.get(UnitOfWork);

    a = await sembrarBarberia();
    b = await sembrarBarberia();
    // Atención de A: lunes 09:00–19:00. Disponibilidad de Luis: lunes 08:00–13:00 y 14:00–20:00.
    await sembrarHorarioAtencion(a.tenantId, [{ dia: 1, inicio: '09:00', fin: '19:00' }]);
    const corte = await sembrarServicio({
      tenantId: a.tenantId,
      nombre: 'Corte',
      precio: '20.00',
      duracionMin: 30,
    });
    const barba = await sembrarServicio({ tenantId: a.tenantId, nombre: 'Barba' });
    const inactivo = await sembrarServicio({ tenantId: a.tenantId, nombre: 'Tinte', activo: false });
    const luis = await sembrarBarbero({
      tenantId: a.tenantId,
      nombre: 'Luis',
      servicios: [corte.servicioId],
    });
    const ana = await sembrarBarbero({
      tenantId: a.tenantId,
      nombre: 'Ana',
      servicios: [corte.servicioId, barba.servicioId],
    });
    const retirado = await sembrarBarbero({
      tenantId: a.tenantId,
      nombre: 'Retirado',
      servicios: [corte.servicioId],
      activo: false,
    });
    await sembrarDisponibilidad(a.tenantId, luis.barberoId, [
      { dia: 1, inicio: '08:00', fin: '13:00' },
      { dia: 1, inicio: '14:00', fin: '20:00' },
    ]);
    await sembrarBloqueo({
      tenantId: a.tenantId,
      barberoId: luis.barberoId,
      inicio: lima('2026-10-19', '10:00'),
      fin: lima('2026-10-19', '11:00'),
      motivo: 'Trámite',
    });
    await sembrarBloqueo({
      tenantId: a.tenantId,
      barberoId: luis.barberoId,
      inicio: lima('2026-10-20', '10:00'),
      fin: lima('2026-10-20', '11:00'),
    });
    // Catálogo de B con un servicio y un barbero propios.
    const deB = await sembrarServicio({ tenantId: b.tenantId, nombre: 'Corte de B' });
    const barberoB = await sembrarBarbero({ tenantId: b.tenantId, servicios: [deB.servicioId] });
    Object.assign(ids, {
      corte: corte.servicioId,
      barba: barba.servicioId,
      inactivo: inactivo.servicioId,
      luis: luis.barberoId,
      ana: ana.barberoId,
      retirado: retirado.barberoId,
      servicioB: deB.servicioId,
      barberoB: barberoB.barberoId,
    });
  });

  afterAll(async () => {
    await prueba.cerrar();
    await cerrarPools();
  });

  it('servicioActivo: datos del servicio activo; null si está inactivo o es de otra barbería', async () => {
    await expect(enA(() => consulta.servicioActivo(ids.corte))).resolves.toEqual({
      servicioId: ids.corte,
      nombre: 'Corte',
      precio: '20.00',
      duracionMin: 30,
    });
    await expect(enA(() => consulta.servicioActivo(ids.inactivo))).resolves.toBeNull();
    await expect(enA(() => consulta.servicioActivo(ids.servicioB))).resolves.toBeNull();
  });

  it('barberoOfrece: activo y con el servicio asignado', async () => {
    await expect(enA(() => consulta.barberoOfrece(ids.luis, ids.corte))).resolves.toBe(true);
    await expect(enA(() => consulta.barberoOfrece(ids.luis, ids.barba))).resolves.toBe(false);
    await expect(enA(() => consulta.barberoOfrece(ids.retirado, ids.corte))).resolves.toBe(false);
    await expect(enA(() => consulta.barberoOfrece(ids.barberoB, ids.servicioB))).resolves.toBe(false);
  });

  it('tramosDelDia: intersección de la disponibilidad con el horario de atención', async () => {
    await expect(enA(() => consulta.tramosDelDia(ids.luis, LUNES))).resolves.toEqual([
      { diaSemana: 1, inicioMin: m('09:00'), finMin: m('13:00') },
      { diaSemana: 1, inicioMin: m('14:00'), finMin: m('19:00') },
    ]);
    // Martes: la barbería no atiende y Luis no tiene disponibilidad.
    await expect(enA(() => consulta.tramosDelDia(ids.luis, LUNES.sumarDias(1)))).resolves.toEqual([]);
    // Ana no definió disponibilidad: sin tramos aunque la barbería atienda.
    await expect(enA(() => consulta.tramosDelDia(ids.ana, LUNES))).resolves.toEqual([]);
  });

  it('bloqueosEnRango: solo los que se solapan con el rango pedido', async () => {
    const delLunes = await enA(() =>
      consulta.bloqueosEnRango(ids.luis, lima('2026-10-19', '00:00'), lima('2026-10-20', '00:00')),
    );
    expect(delLunes).toEqual([{ inicio: lima('2026-10-19', '10:00'), fin: lima('2026-10-19', '11:00') }]);
    // Rango contiguo al bloqueo (11:00–12:00): no se solapa.
    await expect(
      enA(() => consulta.bloqueosEnRango(ids.luis, lima('2026-10-19', '11:00'), lima('2026-10-19', '12:00'))),
    ).resolves.toEqual([]);
  });

  it('barberosQueOfrecen: activos con el servicio, ordenados por nombre', async () => {
    await expect(enA(() => consulta.barberosQueOfrecen(ids.corte))).resolves.toEqual([
      { barberoId: ids.ana, nombre: 'Ana' },
      { barberoId: ids.luis, nombre: 'Luis' },
    ]);
  });

  it('con el tenant de A no devuelve nada de B', async () => {
    await expect(enA(() => consulta.barberosQueOfrecen(ids.servicioB))).resolves.toEqual([]);
    await expect(enA(() => consulta.tramosDelDia(ids.barberoB, LUNES))).resolves.toEqual([]);
    await expect(
      enA(() =>
        consulta.bloqueosEnRango(ids.barberoB, lima('2026-10-01', '00:00'), lima('2026-12-01', '00:00')),
      ),
    ).resolves.toEqual([]);
  });
});
