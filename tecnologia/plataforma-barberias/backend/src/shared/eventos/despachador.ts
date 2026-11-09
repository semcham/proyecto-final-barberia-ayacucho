import { Logger } from '@nestjs/common';
import { sql } from 'kysely';
import type { Clock } from '../clock/clock';
import type { KyselyUnitOfWork } from '../persistence/kysely-unit-of-work';
import { procesarCadaUno, type ResultadoDeTarea } from '../tareas/ejecutor-tareas';
import { TenantId } from '../tenant/tenant-id';
import type { EventoPublicado, ManejadorDeEvento } from './bus-de-eventos';
import type { PendientesDeEventos } from './pendientes-plataforma';

// T028 de 004 · Despacho de la salida de eventos (ADR-025, contracts/eventos.md §2; research R05 y R17):
// - tras el COMMIT, en la réplica que publicó (`despacharEventos`), y en la tarea `despachar-eventos`
//   (`ejecutar`), que lista los pendientes de todas las barberías con el rol de la plataforma;
// - cada evento en una transacción con su tenant y el rol de la aplicación: `FOR UPDATE SKIP LOCKED`, el
//   manejador y PROCESADO en el mismo COMMIT. Dos réplicas nunca procesan el mismo evento;
// - un manejador que falla revierte lo suyo y deja el evento PENDIENTE con attempts + 1 y una espera
//   creciente; desde el intento 10 se registra un error para revisar y se sigue reintentando cada hora;
// - un tipo sin suscriptor queda SIN_MANEJADOR en su primer despacho, con una advertencia (solo tipo e id);
// - la purga de retención borra, barbería por barbería y con RLS, los finales de más de 30 días, en lotes.

export interface OpcionesDespachador {
  /** Pendientes que lista cada corrida de la tarea. */
  lote: number;
  /** Desde este intento fallido se registra un error para revisar (contracts/eventos.md §2.4). */
  intentosParaAvisar: number;
  /** Primera espera tras un fallo del manejador; se duplica en cada intento, hasta `esperaMaximaMs`. */
  esperaInicialMs: number;
  esperaMaximaMs: number;
  /** Retención de los eventos finales (R17: 30 días). */
  retencionDias: number;
  /** Eventos que borra cada corrida en cada barbería. */
  loteDePurga: number;
  /** Barberías que revisa la purga en cada corrida. */
  barberiasPorPurga: number;
}

const POR_DEFECTO: OpcionesDespachador = {
  lote: 100,
  intentosParaAvisar: 10,
  esperaInicialMs: 30_000,
  esperaMaximaMs: 60 * 60 * 1000,
  retencionDias: 30,
  loteDePurga: 200,
  barberiasPorPurga: 100,
};

const DIA_MS = 24 * 60 * 60 * 1000;

type Resultado = 'procesado' | 'sin-manejador' | 'nada';

export class DespachadorDeEventos {
  private readonly logger = new Logger('BusDeEventos');
  private readonly manejadores = new Map<string, ManejadorDeEvento>();
  private readonly opciones: OpcionesDespachador;

  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly pendientes: PendientesDeEventos,
    private readonly reloj: Clock,
    opciones: Partial<OpcionesDespachador> = {},
  ) {
    this.opciones = { ...POR_DEFECTO, ...opciones };
  }

  suscribir(tipo: string, manejador: ManejadorDeEvento): void {
    if (this.manejadores.has(tipo)) throw new Error(`El tipo de evento ${tipo} ya tiene un manejador`);
    this.manejadores.set(tipo, manejador);
  }

  /** Despacho inmediato tras el COMMIT de quien publicó. Un fallo queda en el evento, no se propaga. */
  async despacharEventos(tenantId: TenantId, ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.procesar(tenantId, id).catch(() => undefined);
    }
  }

  /** Corrida de la tarea despachar-eventos: los pendientes de todas las barberías, y después la purga. */
  async ejecutar(): Promise<ResultadoDeTarea> {
    const pendientes = await this.pendientes.listar(this.reloj.ahora(), this.opciones.lote);
    const resultado = await procesarCadaUno(
      pendientes,
      async ({ id, tenantId }) => (await this.procesar(TenantId.de(tenantId), id)) !== 'nada',
    );
    await this.purgar();
    return resultado;
  }

  /** Purga de retención (R17): finales de más de `retencionDias`, por barbería, con su tenant y RLS. */
  async purgar(): Promise<number> {
    const limite = new Date(this.reloj.ahora().getTime() - this.opciones.retencionDias * DIA_MS);
    const barberias = await this.pendientes.barberiasConFinalesAnteriores(
      limite,
      this.opciones.barberiasPorPurga,
    );
    let borrados = 0;
    for (const tenant of barberias) {
      borrados += await this.uow
        .ejecutar(TenantId.de(tenant), async () => {
          const trx = this.uow.transaccionActual();
          const resultado = await trx
            .deleteFrom('outbox_event')
            .where(
              'id',
              'in',
              trx
                .selectFrom('outbox_event')
                .select('id')
                .where('status', '<>', 'PENDIENTE')
                .where('processed_at', '<', limite)
                .orderBy('processed_at')
                .limit(this.opciones.loteDePurga),
            )
            .executeTakeFirst();
          return Number(resultado.numDeletedRows);
        })
        .catch(() => 0);
    }
    return borrados;
  }

  /**
   * Procesa un evento en una transacción con su tenant. Si el manejador falla, la transacción se revierte y el
   * intento se anota aparte; el error se vuelve a lanzar para que la tarea lo cuente como fallido.
   */
  private async procesar(tenantId: TenantId, id: string): Promise<Resultado> {
    try {
      return await this.uow.ejecutar(tenantId, () => this.procesarEnTransaccion(tenantId, id));
    } catch (error) {
      await this.anotarFallo(tenantId, id);
      throw error;
    }
  }

  private async procesarEnTransaccion(tenantId: TenantId, id: string): Promise<Resultado> {
    const trx = this.uow.transaccionActual();
    const ahora = this.reloj.ahora();
    const fila = await trx
      .selectFrom('outbox_event')
      .select(['id', 'type', 'payload', 'created_at'])
      .where('id', '=', id)
      .where('status', '=', 'PENDIENTE')
      .where('available_at', '<=', ahora)
      .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', ahora)]))
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!fila) return 'nada';

    const manejador = this.manejadores.get(fila.type);
    if (!manejador) {
      await this.marcar(id, 'SIN_MANEJADOR', ahora);
      // Solo el tipo y el id: nunca el payload (contracts/eventos.md §2.6).
      this.logger.warn(`EVENTO_SIN_MANEJADOR tipo=${fila.type} id=${fila.id}`);
      return 'sin-manejador';
    }
    const evento: EventoPublicado = {
      id: fila.id,
      tenantId,
      tipo: fila.type,
      payload: fila.payload,
      creadoEn: fila.created_at,
    };
    await manejador(evento);
    await this.marcar(id, 'PROCESADO', ahora);
    return 'procesado';
  }

  private async marcar(id: string, estado: 'PROCESADO' | 'SIN_MANEJADOR', ahora: Date): Promise<void> {
    await this.uow
      .transaccionActual()
      .updateTable('outbox_event')
      .set({ status: estado, processed_at: ahora })
      .where('id', '=', id)
      .execute();
  }

  /** Un intento fallido, en su propia transacción: attempts + 1 y la próxima espera, si sigue pendiente. */
  private async anotarFallo(tenantId: TenantId, id: string): Promise<void> {
    try {
      const intentos = await this.uow.ejecutar(tenantId, async () => {
        const trx = this.uow.transaccionActual();
        const fila = await trx
          .selectFrom('outbox_event')
          .select('attempts')
          .where('id', '=', id)
          .where('status', '=', 'PENDIENTE')
          .forUpdate()
          .executeTakeFirst();
        if (!fila) return null;
        const intento = fila.attempts + 1;
        const espera = Math.min(
          this.opciones.esperaInicialMs * 2 ** (intento - 1),
          this.opciones.esperaMaximaMs,
        );
        await trx
          .updateTable('outbox_event')
          .set({
            attempts: sql<number>`least(attempts + 1, 32767)`,
            next_attempt_at: new Date(this.reloj.ahora().getTime() + espera),
          })
          .where('id', '=', id)
          .execute();
        return intento;
      });
      if (intentos !== null && intentos >= this.opciones.intentosParaAvisar) {
        this.logger.error(`EVENTO_CON_FALLOS id=${id} intentos=${intentos}: revisar el manejador`);
      }
    } catch {
      // Si ni siquiera se puede anotar, el evento sigue pendiente y la tarea lo vuelve a tomar.
    }
  }
}
