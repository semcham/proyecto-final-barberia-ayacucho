import { Injectable } from '@nestjs/common';
import { KyselyUnitOfWork, TenantContext } from '../../../../shared';
import type { ConfiguracionAdelanto, ValoresDeConfiguracion } from '../domain/configuracion-adelanto';
import { ConfiguracionAdelantoRepository } from '../application/ports/configuracion-adelanto-repository';

const COLUMNAS = [
  'enabled',
  'kind',
  'amount_cents',
  'percent',
  'payment_window_minutes',
  'qr_file_id',
  'updated_at',
] as const;

interface Fila {
  enabled: boolean;
  kind: 'FIJO' | 'PORCENTAJE' | null;
  amount_cents: number | null;
  percent: number | null;
  payment_window_minutes: number | null;
  qr_file_id: string | null;
  updated_at: Date;
}

function aConfiguracion(f: Fila): ConfiguracionAdelanto {
  return {
    activo: f.enabled,
    tipo: f.kind,
    montoCentimos: f.amount_cents,
    porcentaje: f.percent,
    plazoMinutos: f.payment_window_minutes,
    qrArchivoId: f.qr_file_id,
    actualizadoEn: f.updated_at,
  };
}

/**
 * T016 de 008 · booking_deposit_settings con Kysely, en la transacción en curso, con RLS y filtro explícito por la
 * barbería del contexto. Crear o cambiar es un solo INSERT ... ON CONFLICT (tenant_id) DO UPDATE: dos primeros
 * guardados simultáneos no chocan.
 */
@Injectable()
export class KyselyConfiguracionAdelanto extends ConfiguracionAdelantoRepository {
  constructor(
    private readonly uow: KyselyUnitOfWork,
    private readonly tenantContext: TenantContext,
  ) {
    super();
  }

  private tenant(): string {
    return this.tenantContext.actual().valor;
  }

  async actual(opciones: { bloquear?: boolean } = {}): Promise<ConfiguracionAdelanto | null> {
    let consulta = this.uow
      .transaccionActual()
      .selectFrom('booking_deposit_settings')
      .select(COLUMNAS)
      .where('tenant_id', '=', this.tenant());
    if (opciones.bloquear) consulta = consulta.forUpdate();
    const fila = await consulta.executeTakeFirst();
    return fila ? aConfiguracion(fila) : null;
  }

  async guardar(
    valores: ValoresDeConfiguracion,
    qrArchivoId: string | null,
    por: string,
    en: Date,
  ): Promise<ConfiguracionAdelanto> {
    const cambios = {
      enabled: valores.activo,
      kind: valores.tipo,
      amount_cents: valores.montoCentimos,
      percent: valores.porcentaje,
      payment_window_minutes: valores.plazoMinutos,
      updated_at: en,
      updated_by: por,
    };
    // PostgreSQL comprueba los CHECK de la fila propuesta antes de ver el conflicto: la fila propuesta lleva el QR
    // vigente, para que "activo exige QR" se evalúe con el mismo dato que la fila que de verdad queda.
    const fila = await this.uow
      .transaccionActual()
      .insertInto('booking_deposit_settings')
      .values({ tenant_id: this.tenant(), qr_file_id: qrArchivoId, ...cambios })
      .onConflict((oc) => oc.column('tenant_id').doUpdateSet(cambios))
      .returning(COLUMNAS)
      .executeTakeFirstOrThrow();
    return aConfiguracion(fila);
  }

  async fijarQr(archivoId: string, por: string, en: Date): Promise<ConfiguracionAdelanto> {
    const cambios = { qr_file_id: archivoId, updated_at: en, updated_by: por };
    const fila = await this.uow
      .transaccionActual()
      .insertInto('booking_deposit_settings')
      .values({ tenant_id: this.tenant(), enabled: false, ...cambios })
      .onConflict((oc) => oc.column('tenant_id').doUpdateSet(cambios))
      .returning(COLUMNAS)
      .executeTakeFirstOrThrow();
    return aConfiguracion(fila);
  }
}
