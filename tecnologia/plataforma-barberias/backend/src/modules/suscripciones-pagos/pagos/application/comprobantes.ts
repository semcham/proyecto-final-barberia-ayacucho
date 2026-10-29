import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { SuscripcionRepository } from '../../suscripciones/application/ports/suscripcion-repository';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import {
  ComprobanteInvalido,
  ComprobanteYaEnRevision,
  DemasiadosComprobantes,
  PagoNoEsperaComprobante,
} from '../domain/errores';
import { transicionDePago } from '../domain/pago';
import {
  detectarTipoComprobante,
  TAMANO_MAXIMO_COMPROBANTE,
  type TipoComprobante,
} from '../domain/tipo-de-archivo';
import { esFechaTransferenciaValida, normalizarNumeroOperacion } from '../domain/transferencia';
import { AlmacenComprobantes, ComprobanteEnRevisionExistente } from './ports/almacen-comprobantes';
import { PagoRepository } from './ports/pago-repository';
import { aPagoVista, type PagoVista } from './vistas';

export interface ComprobanteSubido {
  /** Contenido en memoria (multer, sin disco). El nombre original no llega aquí: nunca se guarda. */
  contenido: Buffer;
  numeroOperacion: string;
  fechaTransferencia: string;
}

/** Un comprobante para descargar: el tipo verificado y el contenido. */
export interface ArchivoComprobante {
  tipo: TipoComprobante;
  contenido: Buffer;
}

/**
 * T080 · El propietario sube el comprobante de su transferencia (FR-020 a FR-021, R05; ADR-023):
 * - el tipo se verifica por los bytes (JPEG, PNG o PDF de hasta 5 MB); el nombre y el Content-Type no
 *   cuentan, y lo que no coincide se descarta antes de guardar nada;
 * - el número de operación se normaliza, y la fecha debe ser real, no futura y de los últimos 30 días;
 * - en UNA transacción con la suscripción y el pago bloqueados: un solo comprobante en revisión, el cupo de
 *   5 por día y por barbería, el comprobante (con su SHA-256) y el pago pasa a EN_REVISION. Si algo falla,
 *   no queda nada, ni el lugar del cupo.
 */
@Injectable()
export class SubirComprobante {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly pagos: PagoRepository,
    private readonly almacen: AlmacenComprobantes,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(actor: ActorDeBarberia, pagoId: string, subido: ComprobanteSubido): Promise<PagoVista> {
    await this.autorizacion.exigir(actor, 'PAGAR_SUSCRIPCION');
    // Antes de la transacción: lo inválido se descarta sin tocar la base.
    if (subido.contenido.length > TAMANO_MAXIMO_COMPROBANTE) {
      throw new ComprobanteInvalido('archivo', 'demasiado_grande');
    }
    const tipo = detectarTipoComprobante(subido.contenido);
    if (!tipo) throw new ComprobanteInvalido('archivo', 'tipo_no_permitido');
    const numero = normalizarNumeroOperacion(subido.numeroOperacion);
    if (!numero) throw new ComprobanteInvalido('numeroOperacion', 'formato');
    const ahora = this.reloj.ahora();
    const hoy = ZonaHoraria.LIMA.fechaDe(ahora);
    if (!esFechaTransferenciaValida(subido.fechaTransferencia, hoy.toString())) {
      throw new ComprobanteInvalido('fechaTransferencia', 'fecha_no_valida');
    }

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      // Orden de bloqueo de todo M03: primero la suscripción, después el pago.
      await this.suscripciones.suscripcionDelTenant({ bloquear: true });
      const pago = await this.pagos.porId(pagoId, { bloquear: true });
      if (!pago) throw new NoEncontrado();
      if (pago.estado === 'EN_REVISION') throw new ComprobanteYaEnRevision();
      if (pago.metodo !== 'TRANSFERENCIA' || pago.estado !== 'ESPERANDO_COMPROBANTE') {
        throw new PagoNoEsperaComprobante();
      }
      if (!(await this.almacen.consumirCupoDiario(hoy.toString()))) {
        const segundos = Math.ceil((ZonaHoraria.LIMA.finDelDia(hoy).getTime() - ahora.getTime()) / 1000);
        throw new DemasiadosComprobantes(Math.max(1, segundos));
      }

      await this.pagos.fijarDatosDeTransferencia(pago.id, {
        numeroOperacion: numero,
        fecha: subido.fechaTransferencia,
      });
      try {
        await this.almacen.guardar({
          id: uuidv7(),
          pagoId: pago.id,
          tipo,
          contenido: subido.contenido,
          subidoPor: actor.usuarioId,
        });
      } catch (error) {
        if (error instanceof ComprobanteEnRevisionExistente) throw new ComprobanteYaEnRevision();
        throw error;
      }
      const transicion = transicionDePago(pago, { tipo: 'COMPROBANTE_SUBIDO' });
      const cambiado = await this.pagos.cambiar(pago.id, {
        desde: pago.estado,
        hacia: transicion.estado,
        marca: null,
      });
      if (!cambiado) throw new Error('El pago cambió durante la transacción a pesar del bloqueo');
      await this.auditoria.registrar({
        accion: 'COMPROBANTE_SUBIDO',
        actorId: actor.usuarioId,
        recurso: `pago:${pago.id}`,
        resultado: 'PERMITIDO',
      });
      const actualizado = await this.pagos.porId(pago.id);
      const plan = await this.suscripciones.planPorId(pago.planId);
      if (!actualizado || !plan) throw new Error('El pago o su plan desaparecieron en la transacción');
      return aPagoVista(actualizado, plan, null);
    });
  }
}

/**
 * Lectura del último comprobante de un pago en la barbería de la transacción en curso: la usan la descarga
 * del propietario y la vista del administrador (con el tenant de la ruta). Un pago o comprobante de otra
 * barbería responde 404, igual que uno inexistente.
 */
@Injectable()
export class LectorDeComprobantes {
  constructor(
    private readonly pagos: PagoRepository,
    private readonly almacen: AlmacenComprobantes,
  ) {}

  async ultimo(pagoId: string): Promise<ArchivoComprobante> {
    const pago = await this.pagos.porId(pagoId);
    if (!pago) throw new NoEncontrado();
    const comprobante = await this.almacen.ultimoDe(pago.id);
    if (!comprobante) throw new NoEncontrado();
    const contenido = await this.almacen.contenido(comprobante.id);
    if (!contenido) throw new NoEncontrado();
    return { tipo: comprobante.tipo, contenido };
  }
}

/** T080 · El propietario descarga el último comprobante de su pago (solo con sesión, FR-041). */
@Injectable()
export class DescargarComprobante {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly lector: LectorDeComprobantes,
  ) {}

  async ejecutar(actor: ActorDeBarberia, pagoId: string): Promise<ArchivoComprobante> {
    await this.autorizacion.exigir(actor, 'VER_SUSCRIPCION');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), () => this.lector.ultimo(pagoId));
  }
}
