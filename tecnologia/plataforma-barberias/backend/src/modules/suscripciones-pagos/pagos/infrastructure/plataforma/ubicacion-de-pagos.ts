import { Injectable } from '@nestjs/common';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';
import {
  type PagoPendiente,
  type UbicacionDePago,
  UbicacionDePagos,
} from '../../application/ports/pago-repository';

/**
 * T043 · Lecturas entre barberías de los pagos (ADR-031): con el rol de solo lectura de la plataforma y solo
 * por clave exacta (la referencia del proveedor) o la lista de pendientes de la conciliación. Lo que se hace
 * con el resultado corre después en una transacción con el tenant de ese pago y RLS.
 */
@Injectable()
export class UbicacionDePagosPlataforma extends UbicacionDePagos {
  constructor(private readonly lectura: LecturaPlataforma) {
    super();
  }

  porReferencia(referenciaProveedor: string): Promise<UbicacionDePago | null> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const fila = await trx
        .selectFrom('payment')
        .select(['tenant_id', 'id'])
        .where('provider_reference', '=', referenciaProveedor)
        .executeTakeFirst();
      return fila ? { tenantId: fila.tenant_id, pagoId: fila.id } : null;
    });
  }

  pendientesCreadosAntesDe(instante: Date, limite: number): Promise<PagoPendiente[]> {
    return this.lectura.ejecutarLectura(async (trx) => {
      const filas = await trx
        .selectFrom('payment')
        .select(['tenant_id', 'id', 'provider_reference', 'created_at'])
        .where('status', '=', 'PENDIENTE')
        .where('created_at', '<', instante)
        .orderBy('created_at')
        .limit(limite)
        .execute();
      return filas.map((f) => ({
        tenantId: f.tenant_id,
        pagoId: f.id,
        referenciaProveedor: f.provider_reference,
        creadoEn: f.created_at,
      }));
    });
  }
}
