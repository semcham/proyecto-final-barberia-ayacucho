import { createHmac, timingSafeEqual } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { type Clock, Interruptor } from '../../../../shared';
import {
  type EstadoEnProveedor,
  type EstadoNotificado,
  FirmaInvalida,
  type LimitesDelMedio,
  type NotificacionVerificada,
  PagoDesconocido,
  type PagoEnProveedor,
  PaymentGateway,
  ProveedorNoDisponible,
  type SesionDePago,
  type SolicitudSesionDePago,
} from '../application/ports/payment-gateway';

export interface ConfiguracionPasarela {
  urlBase: string;
  llaveSecreta: string;
  secretoFirma: string;
  tiempoLimiteMs: number;
}

/** Tolerancia de la marca de tiempo de la firma (FR-014): ±5 minutos. */
const TOLERANCIA_FIRMA_MS = 5 * 60 * 1000;
const ESTADOS_CONSULTA: readonly EstadoEnProveedor[] = ['APROBADO', 'RECHAZADO', 'PENDIENTE', 'EXPIRADO'];
const ESTADOS_NOTIFICADOS: readonly EstadoNotificado[] = [...ESTADOS_CONSULTA, 'DEVUELTO'];
const LIMITES_YAPE: LimitesDelMedio = { minimoCentimos: 600, maximoCentimos: 50_000 };

/** Respuesta del simulador que no es una falla del proveedor (no cuenta para el interruptor). */
type Respuesta = { tipo: 'ok'; estado: number; cuerpo: Record<string, unknown> } | { tipo: 'desconocido' };

function encabezado(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * Adaptador de PaymentGateway contra el simulador de pasarela (ADR-022, research R01; contrato en
 * contracts/pasarela-simulada.md). Habla por HTTP con `fetch`, igual que lo hará el adaptador del proveedor
 * real, así que la caída y la lentitud se prueban de verdad:
 * - cada llamada tiene un tiempo límite (PAGOS_TIEMPO_LIMITE_MS, 2 s);
 * - todas pasan por el interruptor de M06: 5 fallos en 60 s lo abren durante 30 s (R13), y mientras está
 *   abierto se responde `ProveedorNoDisponible` al instante;
 * - la firma de las notificaciones se compara en tiempo constante, con ±5 min de tolerancia; los datos del
 *   pagador que pudiera traer la notificación se descartan (FR-013b).
 */
export class PasarelaSimuladaAdapter extends PaymentGateway {
  private readonly logger = new Logger('PaymentGateway');
  private readonly interruptor: Interruptor;

  constructor(
    private readonly configuracion: ConfiguracionPasarela,
    private readonly reloj: Clock,
  ) {
    super();
    this.interruptor = new Interruptor({
      fallosParaAbrir: 5,
      ventanaMs: 60_000,
      pausaMs: 30_000,
      reloj,
      alAbrir: () =>
        this.logger.warn('PAGOS_PROVEEDOR_NO_DISPONIBLE: la pasarela no responde; circuito abierto'),
      alRecuperar: () => this.logger.log('PAGOS_PROVEEDOR_RECUPERADO'),
    });
  }

  async crearSesionDePago(solicitud: SolicitudSesionDePago): Promise<SesionDePago> {
    const respuesta = await this.llamar('POST', '/v1/sesiones', {
      pago_id: solicitud.pagoId,
      importe_centimos: solicitud.importeCentimos,
      moneda: solicitud.moneda,
      descripcion: solicitud.descripcion,
      metodo: solicitud.metodo,
      url_retorno: solicitud.urlRetorno,
    });
    if (respuesta.tipo !== 'ok' || respuesta.estado !== 201) throw new ProveedorNoDisponible();
    const { referencia, url_pago, expira_en } = respuesta.cuerpo;
    if (typeof referencia !== 'string' || typeof url_pago !== 'string' || typeof expira_en !== 'string') {
      throw new ProveedorNoDisponible();
    }
    return { referenciaProveedor: referencia, urlPago: url_pago, expiraEn: new Date(expira_en) };
  }

  async consultarPago(referenciaProveedor: string): Promise<PagoEnProveedor> {
    const respuesta = await this.llamar('GET', `/v1/sesiones/${encodeURIComponent(referenciaProveedor)}`);
    if (respuesta.tipo === 'desconocido') throw new PagoDesconocido();
    const { estado, importe_centimos, moneda } = respuesta.cuerpo;
    if (
      !ESTADOS_CONSULTA.includes(estado as EstadoEnProveedor) ||
      typeof importe_centimos !== 'number' ||
      typeof moneda !== 'string'
    ) {
      throw new ProveedorNoDisponible();
    }
    return { estado: estado as EstadoEnProveedor, importeCentimos: importe_centimos, moneda };
  }

  async cancelarSesion(referenciaProveedor: string): Promise<boolean> {
    const respuesta = await this.llamar(
      'POST',
      `/v1/sesiones/${encodeURIComponent(referenciaProveedor)}/cancelar`,
    );
    return respuesta.tipo === 'ok' && respuesta.cuerpo.cancelada === true;
  }

  verificarNotificacion(
    cuerpoCrudo: Buffer,
    encabezados: Record<string, string | string[] | undefined>,
  ): NotificacionVerificada {
    const firma = encabezado(encabezados['x-firma']) ?? '';
    const t = /(?:^|,)t=(\d{1,12})(?:,|$)/.exec(firma)?.[1];
    const v1 = /(?:^|,)v1=([0-9a-f]{64})(?:,|$)/.exec(firma)?.[1];
    if (!t || !v1) throw new FirmaInvalida();
    if (Math.abs(this.reloj.ahora().getTime() - Number(t) * 1000) > TOLERANCIA_FIRMA_MS)
      throw new FirmaInvalida();
    const esperada = createHmac('sha256', this.configuracion.secretoFirma)
      .update(`${t}.`)
      .update(cuerpoCrudo)
      .digest();
    const recibida = Buffer.from(v1, 'hex');
    if (recibida.length !== esperada.length || !timingSafeEqual(recibida, esperada))
      throw new FirmaInvalida();

    let cuerpo: Record<string, unknown>;
    try {
      cuerpo = JSON.parse(cuerpoCrudo.toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new FirmaInvalida();
    }
    // Solo se toman los campos del contrato: datos del pagador u otros que mande el proveedor se descartan.
    const { evento_id, tipo, referencia, estado, importe_centimos, moneda, emitido_en } = cuerpo;
    const emitidoEn = typeof emitido_en === 'string' ? new Date(emitido_en) : new Date(Number.NaN);
    if (
      typeof evento_id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(evento_id) ||
      typeof tipo !== 'string' ||
      typeof referencia !== 'string' ||
      referencia.length === 0 ||
      referencia.length > 80 ||
      !ESTADOS_NOTIFICADOS.includes(estado as EstadoNotificado) ||
      typeof importe_centimos !== 'number' ||
      !Number.isSafeInteger(importe_centimos) ||
      importe_centimos < 0 ||
      typeof moneda !== 'string' ||
      !/^[A-Z]{3}$/.test(moneda) ||
      Number.isNaN(emitidoEn.getTime())
    ) {
      throw new FirmaInvalida();
    }
    return {
      eventoId: evento_id,
      tipo: tipo.slice(0, 40),
      referencia,
      estado: estado as EstadoNotificado,
      importeCentimos: importe_centimos,
      moneda,
      emitidoEn,
    };
  }

  limitesYape(): LimitesDelMedio {
    return LIMITES_YAPE;
  }

  /**
   * Llamada a la API del simulador, por el interruptor. Cuenta como falla: tiempo límite, conexión
   * rechazada, 5xx o una respuesta ilegible. Un 404 es "desconocido", no una falla.
   */
  private async llamar(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<Respuesta> {
    return this.interruptor.ejecutar(
      async (): Promise<Respuesta> => {
        const respuesta = await fetch(`${this.configuracion.urlBase}${ruta}`, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${this.configuracion.llaveSecreta}`,
            ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(this.configuracion.tiempoLimiteMs),
        });
        const texto = await respuesta.text();
        if (respuesta.status === 404) return { tipo: 'desconocido' };
        if (!respuesta.ok) throw new Error(`La pasarela respondió ${respuesta.status}`);
        return { tipo: 'ok', estado: respuesta.status, cuerpo: JSON.parse(texto) as Record<string, unknown> };
      },
      () => {
        throw new ProveedorNoDisponible();
      },
    );
  }
}
