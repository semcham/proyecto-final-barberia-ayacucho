import { Injectable } from '@nestjs/common';
import { HISTORIAL_MS } from '../../../acceso-barberias';
import { Clock, type ResultadoDeTarea } from '../../../../shared';
import { IntentosEnlaceRepository } from './ports/intentos-enlace-repository';

const LOTE = 1000;
/** Lotes como máximo por corrida: con miles de rechazos, la purga termina en la siguiente. */
const LOTES_POR_CORRIDA = 50;

/**
 * T093 de 004 · Tarea `purgar-intentos-enlaces` (cada hora, con el candado del ejecutor de ADR-024): borra las filas
 * de `action_link_attempt` de más de 24 h (el historial que usa la regla de bloqueo), en lotes (constitución 1.4.1,
 * principio III, tablas técnicas de intentos).
 */
@Injectable()
export class PurgarIntentosEnlace {
  constructor(
    private readonly intentos: IntentosEnlaceRepository,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const limite = new Date(this.reloj.ahora().getTime() - HISTORIAL_MS);
    let procesados = 0;
    for (let lote = 0; lote < LOTES_POR_CORRIDA; lote += 1) {
      const borrados = await this.intentos.purgarAnterioresA(limite, LOTE);
      procesados += borrados;
      if (borrados < LOTE) break;
    }
    return { procesados, fallidos: 0 };
  }
}
