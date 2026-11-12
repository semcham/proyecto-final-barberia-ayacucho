import { Injectable } from '@nestjs/common';
import {
  BusDeEventos,
  Clock,
  procesarCadaUno,
  type ResultadoDeTarea,
  TenantId,
  UnitOfWork,
} from '../../../../shared';
import { AVISO_FIN_DE_PRUEBA_DIAS, diasRestantes, pruebaPorTerminar } from '../domain/aviso-fin-de-prueba';
import { periodoVigente } from '../domain/periodo';
import { SuscripcionRepository } from './ports/suscripcion-repository';
import { type SuscripcionPorVencer, SuscripcionesPorVencer } from './ports/suscripciones-por-vencer';

const LOTE = 100;
const DIA_MS = 24 * 60 * 60 * 1000;

/** Clave de un solo uso por prueba (contracts/eventos.md §3; índice único de la migración 0021). */
export const clavePruebaPorTerminar = (suscripcionId: string): string =>
  `prueba-por-terminar:${suscripcionId}`;

/**
 * T128 de 004 · Tarea `avisar-fin-de-prueba`, cada 6 h (US5-1; FR-037; research R14). No es una transición de 003:
 * no cambia la suscripción ni toca la tarea de vencimiento.
 *
 * 1. Preselecciona, por la vía de la plataforma y en lotes de 100, las suscripciones en prueba que terminan en los
 *    próximos 3 días (la prueba ya terminada la avisa el vencimiento).
 * 2. En cada barbería, con su tenant y RLS, aplica el MISMO criterio del panel (`pruebaPorTerminar`: en prueba, sin
 *    período siguiente y con 3 días o menos) y publica `PruebaPorTerminar` con la clave `prueba-por-terminar:<id>`.
 * 3. La clave es única en la base: otra corrida, o la otra réplica a la vez, no publica otro (un aviso por prueba).
 */
@Injectable()
export class AvisarFinDePrueba {
  constructor(
    private readonly porTerminar: SuscripcionesPorVencer,
    private readonly suscripciones: SuscripcionRepository,
    private readonly bus: BusDeEventos,
    private readonly uow: UnitOfWork,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(): Promise<ResultadoDeTarea> {
    const ahora = this.reloj.ahora();
    const hasta = new Date(ahora.getTime() + AVISO_FIN_DE_PRUEBA_DIAS * DIA_MS);
    const total: ResultadoDeTarea = { procesados: 0, fallidos: 0 };
    let despuesDe: string | null = null;
    for (;;) {
      const lote = await this.porTerminar.pruebasPorTerminar(ahora, hasta, despuesDe, LOTE);
      if (lote.length === 0) break;
      const resultado = await procesarCadaUno(lote, (elemento) => this.avisar(elemento, ahora));
      total.procesados += resultado.procesados;
      total.fallidos += resultado.fallidos;
      if (lote.length < LOTE) break;
      despuesDe = lote[lote.length - 1].suscripcionId;
    }
    return total;
  }

  /** true si publicó el aviso (false si no corresponde o ya se había publicado). */
  private avisar(elemento: SuscripcionPorVencer, ahora: Date): Promise<boolean> {
    return this.uow.ejecutar(TenantId.de(elemento.tenantId), async () => {
      const suscripcion = await this.suscripciones.suscripcionDelTenant();
      if (!suscripcion || suscripcion.id !== elemento.suscripcionId || !suscripcion.vencePruebaEn) {
        return false;
      }
      // La prueba ya terminada no se avisa como "por terminar": la avisa el vencimiento (SuscripcionVencida).
      if (suscripcion.vencePruebaEn.getTime() <= ahora.getTime()) return false;
      const periodos = await this.suscripciones.periodos(suscripcion.id);
      // Las mismas cuentas que el panel (consultas.ts) para una suscripción en prueba.
      const hastaPanel =
        periodoVigente(suscripcion.cobertura(periodos), ahora)?.fin ?? suscripcion.vencePruebaEn;
      const corresponde = pruebaPorTerminar({
        estado: suscripcion.estado,
        diasRestantes: diasRestantes(hastaPanel, ahora),
        hayPeriodoSiguiente: periodos.some((p) => p.inicio.getTime() > ahora.getTime()),
      });
      if (!corresponde) return false;
      const id = await this.bus.publicarUnaVez(clavePruebaPorTerminar(suscripcion.id), {
        tipo: 'PruebaPorTerminar',
        payload: { suscripcionId: suscripcion.id, finPrueba: suscripcion.vencePruebaEn.toISOString() },
      });
      return id !== null;
    });
  }
}
