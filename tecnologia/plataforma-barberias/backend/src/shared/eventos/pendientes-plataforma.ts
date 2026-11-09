import type { LecturaPlataforma } from '../lectura-plataforma';

// T029 de 004 · Lista de la salida de eventos entre barberías con el rol barberias_plataforma (ADR-025,
// research R08; constitución 1.4.1, principio III, tercera excepción). Lee SOLO las cinco columnas técnicas
// (id, tenant_id, status, available_at, next_attempt_at): ni el tipo ni el payload. Cada evento se procesa
// después en una transacción con su tenant y el rol de la aplicación (despachador.ts).

export interface EventoPorDespachar {
  id: string;
  tenantId: string;
}

const ESTADOS_FINALES = ['PROCESADO', 'ANULADO', 'SIN_MANEJADOR'] as const;

export class PendientesDeEventos {
  constructor(private readonly lectura: LecturaPlataforma) {}

  /** Pendientes ya disponibles y sin espera de reintento, del más antiguo al más nuevo. */
  listar(ahora: Date, limite: number): Promise<EventoPorDespachar[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('outbox_event')
        .select(['id', 'tenant_id'])
        .where('status', '=', 'PENDIENTE')
        .where('available_at', '<=', ahora)
        .where((eb) => eb.or([eb('next_attempt_at', 'is', null), eb('next_attempt_at', '<=', ahora)]))
        .orderBy('available_at')
        .limit(limite)
        .execute();
      return filas.map((f) => ({ id: f.id, tenantId: f.tenant_id }));
    });
  }

  /**
   * Barberías que pueden tener eventos para purgar. Se guía por `available_at`, porque el rol no lee
   * `processed_at`: todo evento final tiene `processed_at >= available_at`, así que la lista incluye a todas las
   * que tienen algo para purgar (y quizás alguna sin nada, que la purga deja igual).
   */
  barberiasConFinalesAnteriores(limite: Date, maximo: number): Promise<string[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('outbox_event')
        .select('tenant_id')
        .distinct()
        .where('status', 'in', ESTADOS_FINALES)
        .where('available_at', '<', limite)
        .limit(maximo)
        .execute();
      return filas.map((f) => f.tenant_id);
    });
  }
}
