import { v7 as uuidv7 } from 'uuid';
import type { Clock } from '../clock/clock';
import type { KyselyUnitOfWork } from '../persistence/kysely-unit-of-work';
import type { TenantContext } from '../tenant/tenant-context';
import { BusDeEventos, type EventoDeDominio, type ManejadorDeEvento } from './bus-de-eventos';
import type { DespachadorDeEventos } from './despachador';

// T028 de 004 · Salida transaccional en PostgreSQL (ADR-025, contracts/eventos.md §1): el evento se inserta en
// outbox_event dentro de la transacción en curso del UnitOfWork, con el tenant de esa transacción (nunca un
// parámetro), así existe si y solo si la operación se confirma (FR-010). Tras el COMMIT pide el despacho en
// esta misma réplica; si la réplica cae antes, lo toma la tarea despachar-eventos de cualquier réplica.
// Es la única escritura de outbox_event fuera del despacho (regla eventos-solo-por-bus de PR14).

/** Tipo en PascalCase, como el CHECK de la migración 0021. */
const TIPO_VALIDO = /^[A-Za-z][A-Za-z0-9]{2,47}$/;

export class SalidaDeEventosPostgres extends BusDeEventos {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
    private readonly despachador: DespachadorDeEventos,
    private readonly reloj: Clock,
  ) {
    super();
  }

  publicar(evento: EventoDeDominio, opciones: { disponibleDesde?: Date } = {}): Promise<string> {
    return this.insertar(null, evento, opciones.disponibleDesde);
  }

  async reemplazar(
    clave: string,
    evento: EventoDeDominio,
    opciones: { disponibleDesde: Date },
  ): Promise<string> {
    await this.anular(clave);
    return this.insertar(clave, evento, opciones.disponibleDesde);
  }

  publicarUnaVez(clave: string, evento: EventoDeDominio): Promise<string | null> {
    return this.insertar(clave, evento, undefined, { siYaExiste: 'nada' });
  }

  async anular(clave: string): Promise<boolean> {
    const trx = this.uow.transaccionActual();
    this.tenantContext.actual();
    const resultado = await trx
      .updateTable('outbox_event')
      .set({ status: 'ANULADO', processed_at: this.reloj.ahora() })
      .where('replace_key', '=', clave)
      .where('status', '=', 'PENDIENTE')
      .executeTakeFirst();
    // RLS limita el UPDATE al tenant de la transacción: una clave igual en otra barbería no se toca.
    return Number(resultado.numUpdatedRows) > 0;
  }

  suscribir(tipo: string, manejador: ManejadorDeEvento): void {
    this.despachador.suscribir(tipo, manejador);
  }

  private async insertar(
    clave: string | null,
    evento: EventoDeDominio,
    disponibleDesde?: Date,
  ): Promise<string>;
  private async insertar(
    clave: string,
    evento: EventoDeDominio,
    disponibleDesde: Date | undefined,
    opciones: { siYaExiste: 'nada' },
  ): Promise<string | null>;
  private async insertar(
    clave: string | null,
    evento: EventoDeDominio,
    disponibleDesde?: Date,
    opciones?: { siYaExiste: 'nada' },
  ): Promise<string | null> {
    // Primero la transacción: publicar fuera de una es un error de programación (FR-010).
    const trx = this.uow.transaccionActual();
    const tenantId = this.tenantContext.actual();
    if (!TIPO_VALIDO.test(evento.tipo)) throw new Error(`Tipo de evento no válido: ${evento.tipo}`);
    const ahora = this.reloj.ahora();
    const disponible = disponibleDesde ?? ahora;
    const id = uuidv7();
    let insercion = trx.insertInto('outbox_event').values({
      id,
      tenant_id: tenantId.valor,
      type: evento.tipo,
      payload: JSON.stringify(evento.payload),
      replace_key: clave,
      available_at: disponible,
    });
    // Con la clave de un solo uso ya tomada, ON CONFLICT DO NOTHING: no inserta y la transacción sigue sana.
    if (opciones?.siYaExiste === 'nada') insercion = insercion.onConflict((oc) => oc.doNothing());
    const resultado = await insercion.executeTakeFirst();
    if (opciones?.siYaExiste === 'nada' && Number(resultado.numInsertedOrUpdatedRows ?? 0n) === 0) {
      return null;
    }
    if (disponible.getTime() <= ahora.getTime()) {
      this.uow.alConfirmar(() => this.despachador.despacharEventos(tenantId, [id]));
    }
    return id;
  }
}
