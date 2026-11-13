import { Injectable } from '@nestjs/common';
import { BusDeEventos, ZonaHoraria } from '../../../../shared';
import {
  type AdelantoParaReservar,
  AdelantosApi,
  type CandidatoPorVencer,
  type DatosDelAdelantoNuevo,
  type ResultadoDeVencimiento,
  type ResumenDeAdelanto,
} from '../../adelantos-api';
import type { CancelacionDeLaCita, EstadoAdelanto } from '../domain/adelanto';
import { PoliticaAdelanto, type ReglaDeAdelanto } from '../domain/politica-adelanto';
import { AdelantoRepository } from './ports/adelanto-repository';
import { ConfiguracionAdelantoRepository } from './ports/configuracion-adelanto-repository';
import { aResumen } from './vista-adelanto';

/** El instante sin sus milisegundos (hacia atrás: la hora límite nunca queda más tarde que la calculada). */
const alSegundo = (instante: Date) => new Date(Math.floor(instante.getTime() / 1000) * 1000);

/** Una operación de AdelantosApi que llega en una fase posterior de 008 (tasks.md): nadie la llama todavía. */
function pendienteDeFase(operacion: string, fase: number): never {
  throw new Error(`AdelantosApi.${operacion} llega en la fase ${fase} de 008`);
}

/**
 * T029 de 008 · Implementación de AdelantosApi (research R01). Todas sus operaciones corren en la transacción del
 * llamador (M02), con su tenant y RLS. Fase 3 (US2): paraReservar, crear, deCita y deCitas; las demás llegan con las
 * fases 4 a 6.
 */
@Injectable()
export class AdelantosApiImpl extends AdelantosApi {
  constructor(
    private readonly configuraciones: ConfiguracionAdelantoRepository,
    private readonly adelantos: AdelantoRepository,
    private readonly eventos: BusDeEventos,
  ) {
    super();
  }

  async paraReservar(cita: {
    precioCentimos: number;
    inicio: Date;
    ahora: Date;
  }): Promise<AdelantoParaReservar | null> {
    const configuracion = await this.configuraciones.actual();
    if (!configuracion?.activo || !configuracion.tipo || !configuracion.qrArchivoId) return null;
    const plazoMinutos = configuracion.plazoMinutos as number;
    const regla: ReglaDeAdelanto =
      configuracion.tipo === 'FIJO'
        ? { tipo: 'FIJO', montoCentimos: configuracion.montoCentimos as number, plazoMinutos }
        : { tipo: 'PORCENTAJE', porcentaje: configuracion.porcentaje as number, plazoMinutos };
    const calculado = PoliticaAdelanto.calcular(regla, {
      precioCentimos: cita.precioCentimos,
      reservadaEn: cita.ahora,
      inicio: cita.inicio,
    });
    if (!calculado) return null;
    // Al segundo: la API muestra las horas sin milisegundos, y la base guarda exactamente lo que se muestra.
    return {
      ...calculado,
      horaLimite: alSegundo(calculado.horaLimite),
      limiteRevision: alSegundo(calculado.limiteRevision),
      qrArchivoId: configuracion.qrArchivoId,
    };
  }

  async crear(datos: DatosDelAdelantoNuevo): Promise<ResumenDeAdelanto> {
    const guardado = await this.adelantos.crear({
      citaId: datos.citaId,
      clienteId: datos.clienteId,
      usuarioClienteId: datos.usuarioClienteId,
      montoCentimos: datos.adelanto.montoCentimos,
      precioCentimos: datos.precioCentimos,
      servicio: datos.servicio,
      inicio: datos.inicio,
      zonaHoraria: datos.zonaHoraria,
      qrArchivoId: datos.adelanto.qrArchivoId,
      horaLimite: datos.adelanto.horaLimite,
      limiteRevision: datos.adelanto.limiteRevision,
    });
    const zona = new ZonaHoraria(datos.zonaHoraria);
    // contracts/eventos.md §1: en la misma transacción que la reserva; sin el QR, teléfonos ni correos (FR-024).
    await this.eventos.publicar({
      tipo: 'AdelantoSolicitado',
      payload: {
        citaId: guardado.citaId,
        clienteId: guardado.clienteId,
        servicio: guardado.servicio,
        inicio: zona.formatoIso(guardado.inicio),
        zonaHoraria: guardado.zonaHoraria,
        montoCentimos: guardado.montoCentimos,
        codigo: guardado.codigo,
        horaLimite: zona.formatoIso(guardado.horaLimite),
      },
    });
    return aResumen(guardado, null);
  }

  async deCita(citaId: string): Promise<ResumenDeAdelanto | null> {
    const adelanto = await this.adelantos.deCita(citaId);
    if (!adelanto) return null;
    const pagos = await this.adelantos.ultimosPagos([adelanto.id]);
    return aResumen(adelanto, pagos.get(adelanto.id) ?? null);
  }

  async deCitas(citaIds: readonly string[]): Promise<ReadonlyMap<string, ResumenDeAdelanto>> {
    const adelantos = await this.adelantos.deCitas(citaIds);
    const pagos = await this.adelantos.ultimosPagos(adelantos.map((a) => a.id));
    return new Map(adelantos.map((a) => [a.citaId, aResumen(a, pagos.get(a.id) ?? null)]));
  }

  confirmar(
    _citaId: string,
    _actorId: string,
    _ahora: Date,
  ): Promise<{ efecto: boolean; adelanto: ResumenDeAdelanto }> {
    return pendienteDeFase('confirmar', 4);
  }

  decidirVencimiento(_citaId: string, _ahora: Date): Promise<ResultadoDeVencimiento | null> {
    return pendienteDeFase('decidirVencimiento', 5);
  }

  porVencer(_ahora: Date, _lote: number): Promise<readonly CandidatoPorVencer[]> {
    return pendienteDeFase('porVencer', 5);
  }

  alCancelar(
    _citaId: string,
    _cancelacion: CancelacionDeLaCita,
    _ahora: Date,
  ): Promise<EstadoAdelanto | null> {
    return pendienteDeFase('alCancelar', 6);
  }

  alNoAsistir(_citaId: string, _ahora: Date): Promise<EstadoAdelanto | null> {
    return pendienteDeFase('alNoAsistir', 6);
  }

  alReprogramar(
    _citaId: string,
    _cita: { inicio: Date; servicio: string; zonaHoraria: string },
  ): Promise<void> {
    return pendienteDeFase('alReprogramar', 6);
  }
}
