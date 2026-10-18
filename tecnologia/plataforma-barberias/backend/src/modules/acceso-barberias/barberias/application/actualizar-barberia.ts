import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId, UnitOfWork } from '../../../../shared';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { ValorInvalido } from '../../identidad/domain/errores';
import { NombreBarberia } from '../domain/nombre-barberia';
import { Slug } from '../domain/slug';
import {
  type CambiosBarberia,
  type ConfiguracionBarberia,
  TenantRepository,
} from './ports/tenant-repository';

/** Lo que el propietario puede cambiar (esquema ActualizarBarberiaRequest del contrato de 002). */
export interface ComandoActualizarBarberia {
  nombre?: string;
  slug?: string;
  direccion?: string | null;
  telefono?: string | null;
  descripcion?: string | null;
  antelacionCancelacionMinutos?: number;
}

/** Texto opcional: recortado; vacío equivale a quitarlo (null). */
function opcional(
  valor: string | null | undefined,
  campo: string,
  maximo: number,
): string | null | undefined {
  if (valor === undefined || valor === null) return valor;
  const limpio = valor.trim();
  if ([...limpio].length > maximo) throw new ValorInvalido(campo, 'longitud');
  return limpio === '' ? null : limpio;
}

/**
 * T050 · Editar datos comerciales, enlace y antelación de cancelación (RF03; FR-001, FR-003; R15). Solo el
 * PROPIETARIO. El UPDATE va sobre la barbería del token (política `tenant_edicion`). Si cambia el enlace,
 * el anterior deja de funcionar al instante (sin redirección) y se audita `ENLACE_CAMBIADO`.
 */
@Injectable()
export class ActualizarBarberia {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly tenants: TenantRepository,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, comando: ComandoActualizarBarberia): Promise<ConfiguracionBarberia> {
    await this.autorizacion.exigir(actor, 'ACTUALIZAR_BARBERIA');
    if (Object.values(comando).every((valor) => valor === undefined)) {
      throw new ValorInvalido('cuerpo', 'sin_cambios');
    }

    const cambios: CambiosBarberia = {
      nombre: comando.nombre === undefined ? undefined : NombreBarberia.crear(comando.nombre).valor,
      slug: comando.slug === undefined ? undefined : Slug.paraEdicion(comando.slug).valor,
      direccion: opcional(comando.direccion, 'direccion', 200),
      telefono: opcional(comando.telefono, 'telefono', 20),
      descripcion: opcional(comando.descripcion, 'descripcion', 500),
      antelacionCancelacionMinutos: comando.antelacionCancelacionMinutos,
    };
    if (cambios.telefono && !/^\+?[0-9 ]{6,20}$/.test(cambios.telefono)) {
      throw new ValorInvalido('telefono', 'formato');
    }

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const antes = await this.tenants.configuracion(actor.tenantId);
      if (!antes) throw new Error('La barbería del token no existe');
      await this.tenants.actualizar(actor.tenantId, cambios);
      if (cambios.slug !== undefined && cambios.slug !== antes.slug) {
        await this.auditoria.registrar({
          accion: 'ENLACE_CAMBIADO',
          actorId: actor.usuarioId,
          // Solo identificadores (FR-050): el enlace nuevo se ve en la barbería, no en la auditoría.
          recurso: `barberia:${actor.tenantId}`,
          resultado: 'PERMITIDO',
        });
      }
      return (await this.tenants.configuracion(actor.tenantId)) as ConfiguracionBarberia;
    });
  }
}
