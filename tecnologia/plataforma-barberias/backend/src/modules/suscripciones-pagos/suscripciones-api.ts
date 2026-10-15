import { Injectable } from '@nestjs/common';
import type { TenantId } from '../../shared';
import {
  IniciarPruebaGratuita,
  type ResumenSuscripcion,
} from './suscripciones/application/iniciar-prueba-gratuita';
import { ObtenerLimiteUsuarios } from './suscripciones/application/obtener-limite-usuarios';

/**
 * Lo que M03 ofrece a otros módulos (matriz de dependencias: M01 → M03). Ambas operaciones participan en
 * la transacción del llamador, que debe tener fijado el mismo tenant.
 */
@Injectable()
export class SuscripcionesApi {
  constructor(
    private readonly iniciarPrueba: IniciarPruebaGratuita,
    private readonly obtenerLimite: ObtenerLimiteUsuarios,
  ) {}

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
