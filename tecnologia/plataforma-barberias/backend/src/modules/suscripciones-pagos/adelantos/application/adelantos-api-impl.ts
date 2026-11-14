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
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { Adelanto, type CancelacionDeLaCita, type EstadoAdelanto } from '../domain/adelanto';
import { PoliticaAdelanto, type ReglaDeAdelanto } from '../domain/politica-adelanto';
import { AdelantoRepository } from './ports/adelanto-repository';
import { AdelantosPorVencerLectura } from './ports/adelantos-por-vencer';
import { ConfiguracionAdelantoRepository } from './ports/configuracion-adelanto-repository';
import { aResumen } from './vista-adelanto';

/** El instante sin sus milisegundos (hacia atrás: la hora límite nunca queda más tarde que la calculada). */
const alSegundo = (instante: Date) => new Date(Math.floor(instante.getTime() / 1000) * 1000);

/** Los estados del adelanto mientras su cita está activa (PENDIENTE o CONFIRMADA). */
const CON_LA_CITA_ACTIVA: readonly EstadoAdelanto[] = ['POR_PAGAR', 'POR_REVISAR', 'CONFIRMADO'];

/**
 * T029 de 008 · Implementación de AdelantosApi (research R01). Todas sus operaciones corren en la transacción del
 * llamador (M02), con su tenant y RLS, salvo porVencer (lectura de la plataforma). Fase 3 (US2): paraReservar, crear,
 * deCita y deCitas; fase 4 (US3): confirmar y enBandeja; fase 5 (US4): porVencer, citaDelAdelanto y
 * decidirVencimiento; fase 6 (US5): alCancelar, alNoAsistir y alReprogramar.
 */
@Injectable()
export class AdelantosApiImpl extends AdelantosApi {
  constructor(
    private readonly configuraciones: ConfiguracionAdelantoRepository,
    private readonly adelantos: AdelantoRepository,
    private readonly eventos: BusDeEventos,
    private readonly porVencerLectura: AdelantosPorVencerLectura,
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

  async enBandeja(
    estado: 'POR_REVISAR' | 'POR_DEVOLVER',
    limite: number,
  ): Promise<readonly ResumenDeAdelanto[]> {
    const adelantos = await this.adelantos.porEstado(estado, limite);
    const pagos = await this.adelantos.ultimosPagos(adelantos.map((a) => a.id));
    return adelantos.map((a) => aResumen(a, pagos.get(a.id) ?? null));
  }

  /**
   * T041 · POR_REVISAR → CONFIRMADO, con el adelanto bloqueado (M02 ya bloqueó la cita, research R06) y el registro de
   * pago vigente marcado como confirmado por el propietario. Sobre uno ya confirmado no hace nada (efecto: false).
   * Lanza NoEncontrado (la cita no tiene adelanto), SinPagoRegistrado o AdelantoResuelto.
   */
  async confirmar(
    citaId: string,
    actorId: string,
    ahora: Date,
  ): Promise<{ efecto: boolean; adelanto: ResumenDeAdelanto }> {
    const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
    if (!adelanto) throw new NoEncontrado();
    const decision = Adelanto.confirmar(adelanto.estado);
    if (decision.efecto) {
      const pago = (await this.adelantos.ultimosPagos([adelanto.id])).get(adelanto.id);
      if (!pago || pago.resultado !== null) throw new Error('Un adelanto POR_REVISAR sin registro vigente');
      await this.adelantos.revisarPago(pago.id, {
        resultado: 'CONFIRMADO',
        por: actorId,
        en: ahora,
        motivo: null,
      });
      const cambiado = await this.adelantos.cambiarEstado(adelanto.id, {
        desde: adelanto.estado,
        hacia: decision.estado,
        en: ahora,
      });
      if (!cambiado) throw new Error('El adelanto cambió durante la transacción a pesar del bloqueo');
    }
    const resumen = await this.deCita(citaId);
    return { efecto: decision.efecto, adelanto: resumen as ResumenDeAdelanto };
  }

  /**
   * T050 · Con la cita ya bloqueada por M02 (research R06), bloquea el adelanto y decide con el dominio (FR-016 a
   * FR-018): sin pago a la hora límite → VENCIDO; con el pago sin revisar al límite máximo adicional → POR_DEVOLVER
   * (el registro de pago queda tal cual, sin revisar: el propietario lo verá al devolver). Si aún no corresponde, o
   * el adelanto ya se resolvió (otra réplica, una confirmación), null sin cambios.
   */
  async decidirVencimiento(citaId: string, ahora: Date): Promise<ResultadoDeVencimiento | null> {
    const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
    if (!adelanto) return null;
    const decision = Adelanto.decidirVencimiento(adelanto.estado, ahora, {
      horaLimite: adelanto.horaLimite,
      limiteRevision: adelanto.limiteRevision,
    });
    if (!decision) return null;
    const cambiado = await this.adelantos.cambiarEstado(adelanto.id, {
      desde: adelanto.estado,
      hacia: decision.estado,
      en: ahora,
    });
    if (!cambiado) throw new Error('El adelanto cambió durante la transacción a pesar del bloqueo');
    const resumen = (await this.deCita(citaId)) as ResumenDeAdelanto;
    return {
      estado: decision.estado as ResultadoDeVencimiento['estado'],
      causa: decision.causa,
      adelanto: resumen,
    };
  }

  porVencer(ahora: Date, lote: number, despuesDe: string | null): Promise<readonly CandidatoPorVencer[]> {
    return this.porVencerLectura.candidatos(ahora, lote, despuesDe);
  }

  citaDelAdelanto(adelantoId: string): Promise<string | null> {
    return this.adelantos.citaDe(adelantoId);
  }

  /**
   * T057 · Al cancelar la cita (research R10; FR-019, FR-021), con la cita ya bloqueada por M02 y el adelanto bloqueado
   * aquí: sin pago → ANULADO; con el pago por revisar → POR_DEVOLVER; confirmado → RETENIDO si cancela tarde el
   * cliente, si no POR_DEVOLVER. Un adelanto ya resuelto (no debería pasar con la cita activa) no se toca: null, y la
   * cancelación sigue (no se impide cancelar por el estado del dinero).
   */
  async alCancelar(
    citaId: string,
    cancelacion: CancelacionDeLaCita,
    ahora: Date,
  ): Promise<EstadoAdelanto | null> {
    const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
    if (!adelanto || !CON_LA_CITA_ACTIVA.includes(adelanto.estado)) return null;
    return this.resolver(
      adelanto.id,
      adelanto.estado,
      Adelanto.alCancelar(adelanto.estado, cancelacion),
      ahora,
    );
  }

  /** T057 · El cliente no asistió a su cita confirmada: CONFIRMADO → RETENIDO (FR-021). null si no aplica. */
  async alNoAsistir(citaId: string, ahora: Date): Promise<EstadoAdelanto | null> {
    const adelanto = await this.adelantos.deCita(citaId, { bloquear: true });
    if (!adelanto || adelanto.estado !== 'CONFIRMADO') return null;
    return this.resolver(adelanto.id, adelanto.estado, Adelanto.alNoAsistir(adelanto.estado), ahora);
  }

  /**
   * T057 · Al reprogramar (research R11): la copia de la hora y del servicio sigue a la cita; el monto, la hora límite
   * y el límite máximo adicional no cambian.
   */
  async alReprogramar(
    citaId: string,
    cita: { inicio: Date; servicio: string; zonaHoraria: string },
  ): Promise<void> {
    await this.adelantos.actualizarCopiaDeLaCita(citaId, { ...cita, inicio: alSegundo(cita.inicio) });
  }

  private async resolver(
    adelantoId: string,
    desde: EstadoAdelanto,
    hacia: EstadoAdelanto,
    ahora: Date,
  ): Promise<EstadoAdelanto> {
    const cambiado = await this.adelantos.cambiarEstado(adelantoId, { desde, hacia, en: ahora });
    if (!cambiado) throw new Error('El adelanto cambió durante la transacción a pesar del bloqueo');
    return hacia;
  }
}
