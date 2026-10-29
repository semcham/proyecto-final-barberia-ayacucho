import { Injectable } from '@nestjs/common';
import { Clock, procesarCadaUno, type ResultadoDeTarea, TenantId, UnitOfWork } from '../../../../shared';
import { DIAS_ESPERA_COMPROBANTE } from '../domain/transferencia';
import { AplicarResultadoDelProveedor } from './aplicar-resultado';
import { type UbicacionDePago, UbicacionDePagos } from './ports/pago-repository';

const DIA_MS = 24 * 60 * 60 * 1000;
const LOTE = 100;

/**
 * T082 · Tarea `expirar-transferencias` (data-model.md §3; ADR-024): una transferencia que lleva 7 días
 * ESPERANDO_COMPROBANTE pasa a EXPIRADO, así el pago abierto no bloquea a la barbería para siempre. Cada pago
 * en su transacción con su tenant y la misma función de siempre; la transición es condicional
 * (`siSigueEn`), así que una subida simultánea del comprobante gana o pierde entera, nunca a medias.
 */
@Injectable()
export class ExpirarTransferencias {
  constructor(
    private readonly ubicaciones: UbicacionDePagos,
    private readonly aplicar: AplicarResultadoDelProveedor,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const limite = new Date(this.reloj.ahora().getTime() - DIAS_ESPERA_COMPROBANTE * DIA_MS);
    const vencidos = await this.ubicaciones.esperandoComprobanteAntesDe(limite, LOTE);
    return procesarCadaUno(vencidos, (pago) => this.expirar(pago));
  }

  private expirar(pago: UbicacionDePago): Promise<boolean> {
    return this.uow.ejecutar(TenantId.de(pago.tenantId), async () => {
      const { efecto } = await this.aplicar.ejecutar(
        pago.pagoId,
        { tipo: 'EXPIRAR' },
        { siSigueEn: 'ESPERANDO_COMPROBANTE' },
      );
      return efecto !== 'SIN_EFECTO';
    });
  }
}
