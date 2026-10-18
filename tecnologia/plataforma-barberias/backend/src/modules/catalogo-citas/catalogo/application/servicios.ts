import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { DatoInvalido, NoEncontrado } from '../domain/errores';
import { type DatosServicio, Servicio } from '../domain/servicio';
import { AutorizacionCatalogoCitas } from './autorizacion';
import { aServicioVista, exigirConfirmacion, type ServicioVista } from './comun';
import { CitasActivasQuery, ServicioRepository } from './ports/catalogo-repositorios';

export interface CambiosServicio extends Partial<DatosServicio> {
  activo?: boolean;
  confirmarConflictos?: boolean;
}

/** T055 · Servicios de la barbería, activos e inactivos (PROPIETARIO y BARBERO). */
@Injectable()
export class ListarServicios {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly servicios: ServicioRepository,
  ) {}

  async ejecutar(actor: Actor): Promise<ServicioVista[]> {
    await this.autorizacion.exigir(actor, 'VER_CATALOGO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () =>
      (await this.servicios.listar()).map(aServicioVista),
    );
  }
}

/** T055 · Crear un servicio (RF07; FR-006). Nace activo; el nombre es único sin distinguir mayúsculas. */
@Injectable()
export class CrearServicio {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly servicios: ServicioRepository,
  ) {}

  async ejecutar(actor: Actor, datos: DatosServicio): Promise<ServicioVista> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_SERVICIOS');
    const servicio = Servicio.crear(uuidv7(), datos);
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await this.servicios.crear(servicio);
      return aServicioVista(servicio);
    });
  }
}

/**
 * T055 · Editar, activar o desactivar un servicio (FR-006 a FR-008). Las citas guardan su copia del
 * servicio, así que editarlo no las cambia. Desactivarlo con citas futuras sigue la confirmación en dos
 * pasos (R11): las citas se mantienen. No existe la operación de eliminar.
 */
@Injectable()
export class ActualizarServicio {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly servicios: ServicioRepository,
    private readonly citas: CitasActivasQuery,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, id: string, cambios: CambiosServicio): Promise<ServicioVista> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_SERVICIOS');
    const { activo, confirmarConflictos, ...datos } = cambios;
    if (activo === undefined && Object.values(datos).every((v) => v === undefined)) {
      throw new DatoInvalido('cuerpo', 'sin_cambios');
    }

    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const servicio = await this.servicios.porId(id);
      if (!servicio) throw new NoEncontrado();
      servicio.editar(datos);

      const desactiva = activo === false && servicio.activo;
      if (desactiva) {
        const zona = new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
        const futuras = await this.citas.futuras({ servicioId: id }, this.reloj.ahora());
        exigirConfirmacion(futuras, confirmarConflictos, zona);
        servicio.desactivar();
      } else if (activo === true) {
        servicio.activar();
      }

      await this.servicios.actualizar(servicio);
      if (desactiva) {
        await this.auditoria.registrar({
          accion: 'SERVICIO_DESACTIVADO',
          actorId: actor.usuarioId,
          recurso: `servicio:${id}`,
          resultado: 'PERMITIDO',
        });
      }
      return aServicioVista(servicio);
    });
  }
}
