import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { type Actor, BarberiasApi } from '../../../acceso-barberias';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { Bloqueo } from '../domain/bloqueo';
import { NoEncontrado } from '../domain/errores';
import { AutorizacionCatalogoCitas } from './autorizacion';
import { aBloqueoVista, barberoAccesible, type BloqueoVista, exigirConfirmacion } from './comun';
import { BarberoRepository, BloqueoRepository, CitasActivasQuery } from './ports/catalogo-repositorios';

export interface ComandoBloqueo {
  inicio: Date;
  fin: Date;
  motivo?: string | null;
  confirmarConflictos?: boolean;
}

/** Dependencias comunes de los casos de uso de bloqueos. */
@Injectable()
export class ContextoBloqueos {
  constructor(
    readonly autorizacion: AutorizacionCatalogoCitas,
    readonly uow: UnitOfWork,
    readonly barberos: BarberoRepository,
    readonly bloqueos: BloqueoRepository,
    readonly barberias: BarberiasApi,
    readonly reloj: Clock,
  ) {}

  async zona(): Promise<ZonaHoraria> {
    return new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
  }
}

/** T058 · Bloqueos futuros de un barbero (PROPIETARIO; BARBERO solo los del barbero vinculado). */
@Injectable()
export class ListarBloqueos {
  constructor(private readonly c: ContextoBloqueos) {}

  async ejecutar(actor: Actor, barberoId: string): Promise<BloqueoVista[]> {
    const alcance = await this.c.autorizacion.exigir(actor, 'GESTIONAR_BLOQUEOS');
    return this.c.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await barberoAccesible(this.c.barberos, actor, alcance, barberoId);
      const zona = await this.c.zona();
      return (await this.c.bloqueos.futuros(barberoId, this.c.reloj.ahora())).map((b) =>
        aBloqueoVista(b, zona),
      );
    });
  }
}

/**
 * T058 · Crear un bloqueo (RF09; FR-015, FR-016). Si se solapa con citas activas, confirmación en dos pasos
 * (R11): la lista va sin datos del cliente; con `confirmarConflictos` se crea, las citas siguen activas (la
 * agenda las marca en conflicto) y se audita `BLOQUEO_CON_CONFLICTO`.
 */
@Injectable()
export class CrearBloqueo {
  constructor(
    private readonly c: ContextoBloqueos,
    private readonly citas: CitasActivasQuery,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, barberoId: string, comando: ComandoBloqueo): Promise<BloqueoVista> {
    const alcance = await this.c.autorizacion.exigir(actor, 'GESTIONAR_BLOQUEOS');
    return this.c.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await barberoAccesible(this.c.barberos, actor, alcance, barberoId);
      const bloqueo = Bloqueo.crear({
        id: uuidv7(),
        barberoId,
        inicio: comando.inicio,
        fin: comando.fin,
        motivo: comando.motivo ?? null,
        creadoPor: actor.usuarioId,
      });
      const zona = await this.c.zona();
      const afectadas = await this.citas.deBarberoEnRango(barberoId, bloqueo.inicio, bloqueo.fin);
      exigirConfirmacion(afectadas, comando.confirmarConflictos, zona);
      await this.c.bloqueos.crear(bloqueo);
      if (afectadas.length > 0) {
        await this.auditoria.registrar({
          accion: 'BLOQUEO_CON_CONFLICTO',
          actorId: actor.usuarioId,
          recurso: `bloqueo:${bloqueo.id}`,
          resultado: 'PERMITIDO',
        });
      }
      return aBloqueoVista(bloqueo, zona);
    });
  }
}

/** T058 · Eliminar un bloqueo (PROPIETARIO; BARBERO solo los del barbero vinculado). */
@Injectable()
export class EliminarBloqueo {
  constructor(private readonly c: ContextoBloqueos) {}

  async ejecutar(actor: Actor, barberoId: string, bloqueoId: string): Promise<void> {
    const alcance = await this.c.autorizacion.exigir(actor, 'GESTIONAR_BLOQUEOS');
    await this.c.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      await barberoAccesible(this.c.barberos, actor, alcance, barberoId);
      const bloqueo = await this.c.bloqueos.porId(barberoId, bloqueoId);
      if (!bloqueo) throw new NoEncontrado();
      await this.c.bloqueos.eliminar(bloqueo.id);
    });
  }
}
