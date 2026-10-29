import { Injectable } from '@nestjs/common';
import { Clock, type TenantId } from '../../shared';
import {
  type ResumenDeSuscripcion,
  ResumenesDeSuscripcionLectura,
} from './plataforma/application/ports/resumenes-de-suscripcion';
import { AvanzarSuscripcion } from './suscripciones/application/avanzar-suscripcion';
import { type EstadoOperativo, ExigirOperacion } from './suscripciones/application/exigir-operacion';
import { SuscripcionRepository } from './suscripciones/application/ports/suscripcion-repository';
import {
  IniciarPruebaGratuita,
  type ResumenSuscripcion,
} from './suscripciones/application/iniciar-prueba-gratuita';
import { ObtenerLimiteBarberos } from './suscripciones/application/obtener-limite-barberos';
import { ObtenerLimiteUsuarios } from './suscripciones/application/obtener-limite-usuarios';
import type { AccionSuscripcion } from './suscripciones/domain/accion-suscripcion';

/**
 * Lo que M03 ofrece a otros módulos (matriz de dependencias: M01 → M03 y M02 → M03). Todas las
 * operaciones participan en la transacción del llamador, que debe tener fijado el mismo tenant.
 */
@Injectable()
export class SuscripcionesApi {
  constructor(
    private readonly iniciarPrueba: IniciarPruebaGratuita,
    private readonly obtenerLimite: ObtenerLimiteUsuarios,
    private readonly obtenerLimiteDeBarberos: ObtenerLimiteBarberos,
    private readonly restricciones: ExigirOperacion,
    private readonly resumenes: ResumenesDeSuscripcionLectura,
    private readonly suscripciones: SuscripcionRepository,
    private readonly avanzar: AvanzarSuscripcion,
    private readonly reloj: Clock,
  ) {}

  /**
   * US5 (T096): estado, plan y cobertura de la suscripción de cada barbería, para el listado del administrador.
   * Es la única operación que NO participa en la transacción del llamador: lee entre barberías con el rol de
   * solo lectura de la plataforma (ADR-031).
   */
  resumenesParaPlataforma(tenantIds: readonly string[]): Promise<Map<string, ResumenDeSuscripcion>> {
    return this.resumenes.deBarberias(tenantIds);
  }

  /**
   * US5 (FR-034, HU01): al reactivar una barbería, su suscripción queda en el estado que le corresponde por sus
   * fechas (siguió su curso durante la suspensión). La tarea de vencimiento ya la mantiene al día; esto cubre lo
   * que la tarea aún no alcanzó. Con la suscripción bloqueada, en la transacción del llamador.
   */
  async ponerAlDia(_tenantId: TenantId): Promise<void> {
    const suscripcion = await this.suscripciones.suscripcionDelTenant({ bloquear: true });
    if (suscripcion) await this.avanzar.ejecutar(suscripcion, this.reloj.ahora());
  }

  /**
   * Exige que el estado de la suscripción permita la acción (FR-006, FR-007): lanza SuscripcionNoPermite
   * (403 SUSCRIPCION_NO_PERMITE, con el detalle { estado, accion }). Los casos de uso de escritura de M02 y
   * M01 la llaman al empezar, dentro de su transacción (contracts/restricciones-estado.md §2).
   */
  exigirOperacion(tenantId: TenantId, accion: AccionSuscripcion): Promise<void> {
    return this.restricciones.exigir(tenantId, accion);
  }

  /** Para avisar en la interfaz antes de intentar la operación (GET /suscripcion/estado-operativo). */
  estadoOperativo(tenantId: TenantId): Promise<EstadoOperativo> {
    return this.restricciones.estadoOperativo(tenantId);
  }

  /**
   * Máximo de barberos activos del plan (FR-012 de 002). Deja bloqueada la fila de la suscripción hasta
   * que termine la transacción del llamador, para que contar y crear (o reactivar) sean atómicos.
   */
  obtenerLimiteBarberos(tenantId: TenantId): Promise<number> {
    return this.obtenerLimiteDeBarberos.ejecutar(tenantId);
  }

  iniciarPruebaGratuita(tenantId: TenantId): Promise<ResumenSuscripcion> {
    return this.iniciarPrueba.ejecutar(tenantId);
  }

  obtenerLimiteUsuarios(tenantId: TenantId): Promise<number> {
    return this.obtenerLimite.ejecutar(tenantId);
  }

  /**
   * Igual que obtenerLimiteUsuarios, pero deja bloqueada la fila de la suscripción hasta que termine la
   * transacción del llamador. Se usa antes de agregar personal, para que el conteo y el alta sean atómicos
   * frente a otras altas simultáneas (FR-020).
   */
  bloquearYObtenerLimiteUsuarios(tenantId: TenantId): Promise<number> {
    return this.obtenerLimite.ejecutar(tenantId, { bloquear: true });
  }
}
