import { Logger } from '@nestjs/common';
import { TenantId } from '../../../src/shared/tenant/tenant-id';
import { crearInstanciaDeEventos, type InstanciaDeEventos } from '../../helpers/eventos';
import { sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools, poolDe } from '../../helpers/test-db';

// T014 de 004 · Evento sin manejador (contracts/eventos.md §2, punto 6; FR-012; decisión del responsable del
// 2026-11-04): queda SIN_MANEJADOR en su primer despacho, con una advertencia que solo dice el tipo y el id
// (nunca el payload), y no se reintenta ni consume intentos. Un evento con suscriptor no se ve afectado.

const PAYLOAD_SENSIBLE = { citaId: 'c-77', nota: 'contenido-que-no-debe-registrarse-0451' };

async function estado(id: string) {
  const { rows } = await poolDe('seed').query<{ status: string; attempts: number; procesado: boolean }>(
    'SELECT status, attempts, processed_at IS NOT NULL AS procesado FROM outbox_event WHERE id = $1',
    [id],
  );
  return rows[0];
}

describe('Evento sin manejador (contracts/eventos.md §2.6)', () => {
  let instancia: InstanciaDeEventos;
  let tenant: TenantId;
  let advertencias: jest.SpyInstance;

  beforeAll(async () => {
    instancia = crearInstanciaDeEventos();
    tenant = TenantId.de((await sembrarBarberia()).tenantId);
  });

  beforeEach(() => {
    advertencias = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await instancia.cerrar();
    await cerrarPools();
  });

  it('queda SIN_MANEJADOR en el primer despacho, con una advertencia sin el payload, y no se reintenta', async () => {
    const { uow, bus, despachador } = instancia;
    const id = await uow.ejecutar(tenant, () =>
      bus.publicar({ tipo: 'TipoSinSuscriptor', payload: PAYLOAD_SENSIBLE }),
    );
    expect(await estado(id)).toEqual({ status: 'SIN_MANEJADOR', attempts: 0, procesado: true });

    const mensajes = advertencias.mock.calls.map((llamada) => String(llamada[0]));
    const propios = mensajes.filter((m) => m.includes(id));
    expect(propios).toHaveLength(1);
    expect(propios[0]).toContain('TipoSinSuscriptor');
    expect(mensajes.join('\n')).not.toContain(PAYLOAD_SENSIBLE.nota);
    expect(mensajes.join('\n')).not.toContain(PAYLOAD_SENSIBLE.citaId);

    // Ni la tarea ni un despacho posterior lo vuelven a tomar, aunque el tipo ya tenga suscriptor.
    const tardio = jest.fn(async () => undefined);
    despachador.suscribir('TipoSinSuscriptor', tardio);
    await despachador.ejecutar();
    await despachador.despacharEventos(tenant, [id]);
    expect(tardio).not.toHaveBeenCalled();
    expect(await estado(id)).toEqual({ status: 'SIN_MANEJADOR', attempts: 0, procesado: true });
  });

  it('un evento con suscriptor no se ve afectado', async () => {
    const { uow, bus, despachador } = instancia;
    const manejador = jest.fn(async () => undefined);
    despachador.suscribir('TipoConSuscriptor', manejador);
    const id = await uow.ejecutar(tenant, () => bus.publicar({ tipo: 'TipoConSuscriptor', payload: {} }));
    expect(manejador).toHaveBeenCalledTimes(1);
    expect(await estado(id)).toEqual({ status: 'PROCESADO', attempts: 0, procesado: true });
    expect(advertencias.mock.calls.map((l) => String(l[0])).filter((m) => m.includes(id))).toEqual([]);
  });
});
