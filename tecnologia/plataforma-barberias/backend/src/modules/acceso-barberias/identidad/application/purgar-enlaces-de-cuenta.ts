import { Injectable } from '@nestjs/common';
import { Clock, procesarCadaUno, type ResultadoDeTarea, TenantId, UnitOfWork } from '../../../../shared';
import { BarberiasParaRetencion, EnlaceDeCuentaRepository } from './ports/enlace-de-cuenta-repository';

/** Retención de los enlaces terminados (data-model §2): 30 días. */
export const RETENCION_ENLACES_DIAS = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
/**
 * Todas las barberías en cada corrida (cada 6 h): en cada una es un solo DELETE por índice. Con más de este número, el
 * orden aleatorio reparte las que quedan fuera entre corridas.
 */
const BARBERIAS_POR_CORRIDA = 10_000;
const LOTE = 500;

/**
 * T045 de 010 · Tarea `purgar-enlaces-de-cuenta` (ADR-024): borra los enlaces usados, anulados o vencidos hace más de
 * 30 días. Recorre las barberías (solo sus ids, con el rol de lectura de la plataforma) y borra en cada una con SU
 * tenant y el rol de la aplicación (RLS). Es idempotente: si dos réplicas la corren a la vez, cada fila se borra una
 * sola vez y la otra no encuentra nada.
 */
@Injectable()
export class PurgarEnlacesDeCuenta {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly barberias: BarberiasParaRetencion,
    private readonly enlaces: EnlaceDeCuentaRepository,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const limite = new Date(this.reloj.ahora().getTime() - RETENCION_ENLACES_DIAS * DIA_MS);
    const barberias = await this.barberias.listar(BARBERIAS_POR_CORRIDA);
    return procesarCadaUno(barberias, async (tenantId) => {
      const borrados = await this.uow.ejecutar(TenantId.de(tenantId), () =>
        this.enlaces.purgarTerminados(limite, LOTE),
      );
      return borrados > 0;
    });
  }
}
