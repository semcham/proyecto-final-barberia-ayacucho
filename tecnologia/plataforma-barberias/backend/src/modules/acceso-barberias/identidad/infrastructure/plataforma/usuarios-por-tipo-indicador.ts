import { Injectable } from '@nestjs/common';
import type { FuenteDeIndicador } from '../../../../../shared';
import { LecturaPlataforma } from '../../../../../shared/lectura-plataforma';

export interface UsuariosPorTipo {
  /** Membresías activas de propietarios y barberos. */
  personal: number;
  /** Membresías activas de clientes (una persona con cuenta en dos barberías cuenta una vez por barbería). */
  clientes: number;
}

/**
 * T049 de 007 · Fuente de indicadores de M01 (US2, FR-012; research R01): los usuarios por tipo, como membresías
 * activas de todas las barberías. Lee SOLO la vista de solo conteo `platform_membership_counts` con el rol de la
 * plataforma (enmienda 1.7.0, revisión de ADR-031): ese rol no tiene ningún permiso sobre `membership` ni
 * `user_account`. Solo números.
 */
@Injectable()
export class UsuariosPorTipoIndicador implements FuenteDeIndicador {
  readonly nombre = 'usuarios';

  constructor(private readonly lectura: LecturaPlataforma) {}

  async calcular(): Promise<UsuariosPorTipo> {
    const filas = await this.lectura.ejecutarLectura((trx) =>
      trx.selectFrom('platform_membership_counts').select(['kind', 'users']).execute(),
    );
    const de = (tipo: 'PERSONAL' | 'CLIENTE') => filas.find((f) => f.kind === tipo)?.users ?? 0;
    return { personal: de('PERSONAL'), clientes: de('CLIENTE') };
  }
}
