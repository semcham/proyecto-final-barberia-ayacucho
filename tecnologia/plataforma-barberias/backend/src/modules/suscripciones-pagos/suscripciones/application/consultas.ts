import { Injectable } from '@nestjs/common';
import { Clock, Configuracion, TenantId, UnitOfWork } from '../../../../shared';
import { PagoRepository } from '../../pagos/application/ports/pago-repository';
import { PaymentGateway } from '../../pagos/application/ports/payment-gateway';
import {
  aPagoVista,
  aPlanVista,
  cuentaDeTransferencia,
  type PagoVista,
  type PlanVista,
} from '../../pagos/application/vistas';
import { NoEncontrado } from '../domain/errores';
import { finDeGracia, periodoVigente, ultimoPeriodoEmpezado } from '../domain/periodo';
import type { Plan } from '../domain/plan';
import type { EstadoSuscripcion } from '../domain/suscripcion';
import { type ActorDeBarberia, AutorizacionSuscripciones } from './autorizacion';
import { type EstadoOperativo, ExigirOperacion } from './exigir-operacion';
import { SuscripcionRepository } from './ports/suscripcion-repository';

const DIA_MS = 24 * 60 * 60 * 1000;
/** Días antes del fin de la prueba en que el panel avisa que está por terminar. */
const AVISO_FIN_DE_PRUEBA_DIAS = 3;

export type AvisoSuscripcion = 'EN_GRACIA' | 'PRUEBA_POR_TERMINAR' | 'VENCIDA' | 'SUSPENDIDA';

export interface SuscripcionVista {
  estado: EstadoSuscripcion;
  plan: PlanVista;
  iniciaEn: Date;
  finPrueba: Date | null;
  finCobertura: Date | null;
  finGracia: Date | null;
  diasRestantes: number;
  proximoPeriodo: { plan: PlanVista; iniciaEn: Date } | null;
  limites: { maxUsuarios: number; maxBarberos: number };
  motivoSuspension: string | null;
  pagoAbierto: PagoVista | null;
  avisos: AvisoSuscripcion[];
}

/** Lo que ven barberos y clientes: si la barbería acepta reservas, sin el estado de la suscripción (FR-039). */
export type EstadoOperativoVista = EstadoOperativo | Pick<EstadoOperativo, 'aceptaReservas' | 'mensaje'>;

/**
 * T044 · Consultas del propietario sobre su suscripción (RF19; FR-001, FR-002, FR-039). Cada una corre en
 * una transacción con el tenant del token y RLS.
 */
@Injectable()
export class ConsultasDeSuscripcion {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly suscripciones: SuscripcionRepository,
    private readonly pagos: PagoRepository,
    private readonly pasarela: PaymentGateway,
    private readonly restricciones: ExigirOperacion,
    private readonly reloj: Clock,
    private readonly configuracion: Configuracion,
  ) {}

  /** Planes contratables, del más barato al más caro, con los medios disponibles para cada uno. */
  async planes(actor: ActorDeBarberia): Promise<PlanVista[]> {
    await this.autorizacion.exigir(actor, 'VER_PLANES');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () =>
      (await this.suscripciones.planesContratables()).map((plan) => this.vistaDe(plan)),
    );
  }

  /** Estado, plan vigente, fechas, días restantes, límites, próximo período, pago abierto y avisos (FR-001). */
  async suscripcion(actor: ActorDeBarberia): Promise<SuscripcionVista> {
    await this.autorizacion.exigir(actor, 'VER_SUSCRIPCION');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const suscripcion = await this.suscripciones.suscripcionDelTenant();
      if (!suscripcion) throw new NoEncontrado();
      const ahora = this.reloj.ahora();
      const periodos = await this.suscripciones.periodos(suscripcion.id);
      const cobertura = suscripcion.cobertura(periodos);
      const plan = await this.plan(suscripcion.planVigente(periodos, ahora));
      const vigente = periodoVigente(cobertura, ahora);
      const proximo = periodos.find((p) => p.inicio.getTime() > ahora.getTime()) ?? null;
      const ultimo = ultimoPeriodoEmpezado(cobertura, ahora);
      const finGracia =
        suscripcion.estado === 'PAST_DUE'
          ? (suscripcion.graciaHasta ?? (ultimo ? finDeGracia(ultimo.fin) : null))
          : null;
      const hasta =
        suscripcion.estado === 'PAST_DUE' ? finGracia : (vigente?.fin ?? suscripcion.vencePruebaEn);
      const diasRestantes = hasta ? Math.max(0, Math.ceil((hasta.getTime() - ahora.getTime()) / DIA_MS)) : 0;
      const abierto = await this.pagos.abiertoDe(suscripcion.id);

      const avisos: AvisoSuscripcion[] = [];
      if (suscripcion.estado === 'PAST_DUE') avisos.push('EN_GRACIA');
      if (suscripcion.estado === 'EXPIRED') avisos.push('VENCIDA');
      if (suscripcion.estado === 'SUSPENDED') avisos.push('SUSPENDIDA');
      if (suscripcion.estado === 'TRIAL' && !proximo && diasRestantes <= AVISO_FIN_DE_PRUEBA_DIAS) {
        avisos.push('PRUEBA_POR_TERMINAR');
      }

      return {
        estado: suscripcion.estado,
        plan: this.vistaDe(plan),
        iniciaEn: suscripcion.iniciaEn,
        finPrueba: suscripcion.vencePruebaEn,
        finCobertura: suscripcion.finCobertura,
        finGracia,
        diasRestantes,
        proximoPeriodo: proximo
          ? { plan: this.vistaDe(await this.plan(proximo.planId)), iniciaEn: proximo.inicio }
          : null,
        limites: { maxUsuarios: plan.maxUsuarios, maxBarberos: plan.maxBarberos },
        motivoSuspension: suscripcion.motivoSuspension,
        pagoAbierto: abierto ? await this.pagoVista(abierto.id) : null,
        avisos,
      };
    });
  }

  /** El propietario ve todo; barberos y clientes, solo si se aceptan reservas y el mensaje (FR-039, M8). */
  async estadoOperativo(actor: ActorDeBarberia): Promise<EstadoOperativoVista> {
    await this.autorizacion.exigir(actor, 'VER_ESTADO_OPERATIVO');
    const tenant = TenantId.de(actor.tenantId);
    const estado = await this.uow.ejecutar(tenant, () => this.restricciones.estadoOperativo(tenant));
    return actor.rol === 'PROPIETARIO'
      ? estado
      : { aceptaReservas: estado.aceptaReservas, mensaje: estado.mensaje };
  }

  /** Un pago de la barbería; el de otra barbería responde 404, igual que uno inexistente (PR09). */
  async pago(actor: ActorDeBarberia, pagoId: string): Promise<PagoVista> {
    await this.autorizacion.exigir(actor, 'VER_SUSCRIPCION');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), () => this.pagoVista(pagoId));
  }

  private async pagoVista(pagoId: string): Promise<PagoVista> {
    const pago = await this.pagos.porId(pagoId);
    if (!pago) throw new NoEncontrado();
    const plan = await this.plan(pago.planId);
    return aPagoVista(pago, plan, await this.pagos.periodoDe(pago.id));
  }

  private async plan(planId: string): Promise<Plan> {
    const plan = await this.suscripciones.planPorId(planId);
    if (!plan) throw new Error(`No existe el plan ${planId}`);
    return plan;
  }

  private vistaDe(plan: Plan): PlanVista {
    const conTransferencia = cuentaDeTransferencia(this.configuracion.pagos.cuenta) !== null;
    return aPlanVista(plan, this.pasarela.limitesYape(), conTransferencia);
  }
}
