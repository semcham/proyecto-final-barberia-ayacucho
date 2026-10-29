import { Injectable } from '@nestjs/common';
import { AuditLog, TenantId, UnitOfWork } from '../../../../../shared';
import { SuscripcionesApi } from '../../../../suscripciones-pagos';
import type { ActorPlataforma } from '../../../identidad/application/validar-solicitud-plataforma';
import { BarberiaNoEncontrada, BarberiaYaEnEseEstado } from '../../domain/errores';
import { TenantRepository } from '../ports/tenant-repository';
import { BarberiasPlataformaLectura } from './ports/barberias-plataforma';

// T096 · US5 de 003: el administrador de la plataforma lista, suspende y reactiva barberías (RF02; FR-034, FR-037,
// FR-038). Las escrituras corren con el tenant de la RUTA fijado y RLS (ADR-031, H5): `tenant.status` solo
// cambia en la barbería de la transacción, y cada acción queda en su audit_log con el administrador como actor.

/** Barberías por página del listado del administrador. */
export const TAMANO_PAGINA_BARBERIAS = 20;
/** Tope de la página pedida (evita un OFFSET enorme). */
export const MAXIMA_PAGINA_BARBERIAS = 500;

/** Esquema BarberiaPlataforma del contrato: identidad, estados, plan y cobertura. Nada de negocio (FR-038). */
export interface BarberiaPlataformaVista {
  id: string;
  nombre: string;
  slug: string;
  estadoBarberia: 'ACTIVA' | 'SUSPENDIDA';
  estadoSuscripcion: string;
  plan?: string;
  finCobertura: Date | null;
}

/** Sin suscripción (no debería pasar: toda barbería nace con su prueba). */
const SIN_SUSCRIPCION = 'SIN_SUSCRIPCION';

@Injectable()
export class ListarBarberiasPlataforma {
  constructor(
    private readonly lectura: BarberiasPlataformaLectura,
    private readonly suscripciones: SuscripcionesApi,
  ) {}

  async ejecutar(
    _admin: ActorPlataforma,
    buscar: string | null,
    pagina: number,
  ): Promise<{ barberias: BarberiaPlataformaVista[]; total: number }> {
    const { barberias, total } = await this.lectura.pagina(buscar, pagina, TAMANO_PAGINA_BARBERIAS);
    const resumenes = await this.suscripciones.resumenesParaPlataforma(barberias.map((b) => b.id));
    return {
      barberias: barberias.map((b) => {
        const resumen = resumenes.get(b.id);
        return {
          id: b.id,
          nombre: b.nombre,
          slug: b.slug,
          estadoBarberia: b.estado,
          estadoSuscripcion: resumen?.estado ?? SIN_SUSCRIPCION,
          ...(resumen ? { plan: resumen.plan } : {}),
          finCobertura: resumen?.finCobertura ?? null,
        };
      }),
      total,
    };
  }
}

/**
 * Suspende la barbería (FR-034): sus usuarios no pueden iniciar sesión (403 ACCESO_SUSPENDIDO, 001) y las
 * sesiones abiertas dejan de servir en la solicitud siguiente (ValidarSolicitud comprueba el estado de la
 * barbería); su enlace público responde "barbería no disponible" (404 BARBERIA_NO_DISPONIBLE, 002). No se borra
 * nada. La suscripción sigue su curso (la tarea de vencimiento no mira el estado de la barbería).
 */
@Injectable()
export class SuspenderBarberia {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tenants: TenantRepository,
    private readonly auditoria: AuditLog,
  ) {}

  ejecutar(admin: ActorPlataforma, barberiaId: string, motivo: string): Promise<void> {
    return this.uow.ejecutar(TenantId.de(barberiaId), async () => {
      const estado = await this.tenants.estado(barberiaId);
      if (!estado) throw new BarberiaNoEncontrada();
      if (
        estado === 'SUSPENDIDA' ||
        !(await this.tenants.cambiarEstado(barberiaId, 'ACTIVA', 'SUSPENDIDA'))
      ) {
        throw new BarberiaYaEnEseEstado('SUSPENDIDA');
      }
      await this.auditoria.registrar({
        accion: 'BARBERIA_SUSPENDIDA',
        actorId: admin.adminId,
        recurso: `barberia:${barberiaId}`,
        resultado: 'PERMITIDO',
        motivo,
      });
    });
  }
}

/**
 * Reactiva la barbería (FR-034, HU01): sus usuarios vuelven a entrar y su enlace vuelve a funcionar. La
 * suscripción queda en el estado que le corresponde por sus fechas (si su período venció mientras tanto, vencida).
 */
@Injectable()
export class ReactivarBarberia {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tenants: TenantRepository,
    private readonly suscripciones: SuscripcionesApi,
    private readonly auditoria: AuditLog,
  ) {}

  ejecutar(admin: ActorPlataforma, barberiaId: string): Promise<void> {
    const tenantId = TenantId.de(barberiaId);
    return this.uow.ejecutar(tenantId, async () => {
      const estado = await this.tenants.estado(barberiaId);
      if (!estado) throw new BarberiaNoEncontrada();
      if (estado === 'ACTIVA' || !(await this.tenants.cambiarEstado(barberiaId, 'SUSPENDIDA', 'ACTIVA'))) {
        throw new BarberiaYaEnEseEstado('ACTIVA');
      }
      await this.auditoria.registrar({
        accion: 'BARBERIA_REACTIVADA',
        actorId: admin.adminId,
        recurso: `barberia:${barberiaId}`,
        resultado: 'PERMITIDO',
      });
      await this.suscripciones.ponerAlDia(tenantId);
    });
  }
}
