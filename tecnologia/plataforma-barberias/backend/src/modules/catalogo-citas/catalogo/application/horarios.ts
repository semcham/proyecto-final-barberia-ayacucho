import { Injectable } from '@nestjs/common';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { FueraDelHorarioDeAtencion } from '../domain/errores';
import { AutorizacionCatalogoCitas } from './autorizacion';
import {
  aHorarioVista,
  barberoAccesible,
  exigirConfirmacion,
  fueraDelHorario,
  type HorarioVista,
  horarioDesde,
  type TramoVista,
} from './comun';
import { BarberoRepository, CitasActivasQuery, HorarioRepository } from './ports/catalogo-repositorios';

export interface ComandoHorario {
  tramos: readonly TramoVista[];
  confirmarConflictos?: boolean;
}

/** T057 · Horario de atención semanal de la barbería (PROPIETARIO y BARBERO). */
@Injectable()
export class ObtenerHorarioAtencion {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly horarios: HorarioRepository,
  ) {}

  async ejecutar(actor: Actor): Promise<HorarioVista> {
    await this.autorizacion.exigir(actor, 'VER_HORARIO_ATENCION');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () =>
      aHorarioVista(await this.horarios.atencion()),
    );
  }
}

/**
 * T057 · Reemplazar el horario de atención (RF03; FR-002, FR-004, FR-005). Tramos con cierre ≤ apertura o
 * solapados → 400 con el día. Si deja citas activas futuras fuera, confirmación en dos pasos (R11): con
 * `confirmarConflictos` se guarda, las citas no cambian y se audita `CAMBIO_CON_CONFLICTO`.
 */
@Injectable()
export class ReemplazarHorarioAtencion {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly horarios: HorarioRepository,
    private readonly citas: CitasActivasQuery,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, comando: ComandoHorario): Promise<HorarioVista> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_HORARIO_ATENCION');
    const nuevo = horarioDesde(comando.tramos);
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const zona = new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
      const afectadas = fueraDelHorario(await this.citas.futuras({}, this.reloj.ahora()), nuevo, zona);
      exigirConfirmacion(afectadas, comando.confirmarConflictos, zona);
      await this.horarios.reemplazarAtencion(nuevo);
      if (afectadas.length > 0) {
        await this.auditoria.registrar({
          accion: 'CAMBIO_CON_CONFLICTO',
          actorId: actor.usuarioId,
          // Solo identificadores (FR-050): el horario de atención es de la barbería del token.
          recurso: `horario-atencion:${actor.tenantId}`,
          resultado: 'PERMITIDO',
        });
      }
      return aHorarioVista(nuevo);
    });
  }
}

/** T057 · Disponibilidad semanal de un barbero (PROPIETARIO; BARBERO solo la del barbero vinculado). */
@Injectable()
export class ObtenerDisponibilidad {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly barberos: BarberoRepository,
    private readonly horarios: HorarioRepository,
  ) {}

  async ejecutar(actor: Actor, barberoId: string): Promise<HorarioVista> {
    const alcance = await this.autorizacion.exigir(actor, 'GESTIONAR_DISPONIBILIDAD');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await barberoAccesible(this.barberos, actor, alcance, barberoId);
      return aHorarioVista(await this.horarios.disponibilidad(barberoId));
    });
  }
}

/**
 * T057 · Reemplazar la disponibilidad semanal de un barbero (RF09; FR-013, FR-014). Debe quedar dentro del
 * horario de atención (422 con el día). Si deja citas activas futuras del barbero fuera, confirmación en dos
 * pasos (R11).
 */
@Injectable()
export class ReemplazarDisponibilidad {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly barberos: BarberoRepository,
    private readonly horarios: HorarioRepository,
    private readonly citas: CitasActivasQuery,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, barberoId: string, comando: ComandoHorario): Promise<HorarioVista> {
    const alcance = await this.autorizacion.exigir(actor, 'GESTIONAR_DISPONIBILIDAD');
    const nueva = horarioDesde(comando.tramos);
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await barberoAccesible(this.barberos, actor, alcance, barberoId);
      const atencion = await this.horarios.atencion();
      const fuera = nueva
        .todos()
        .find(
          (t) =>
            !atencion.tramosDe(t.diaSemana).some((a) => a.inicioMin <= t.inicioMin && t.finMin <= a.finMin),
        );
      if (fuera) throw new FueraDelHorarioDeAtencion(fuera.diaSemana);

      const zona = new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
      const afectadas = fueraDelHorario(
        await this.citas.futuras({ barberoId }, this.reloj.ahora()),
        nueva,
        zona,
      );
      exigirConfirmacion(afectadas, comando.confirmarConflictos, zona);
      await this.horarios.reemplazarDisponibilidad(barberoId, nueva);
      if (afectadas.length > 0) {
        await this.auditoria.registrar({
          accion: 'CAMBIO_CON_CONFLICTO',
          actorId: actor.usuarioId,
          recurso: `disponibilidad:${barberoId}`,
          resultado: 'PERMITIDO',
        });
      }
      return aHorarioVista(nueva);
    });
  }
}
