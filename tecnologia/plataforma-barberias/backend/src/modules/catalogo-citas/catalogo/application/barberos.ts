import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { type Actor, BarberiasApi, PersonalApi } from '../../../acceso-barberias';
import { SuscripcionesApi } from '../../../suscripciones-pagos';
import { AuditLog, Clock, TenantId, UnitOfWork, ZonaHoraria } from '../../../../shared';
import { Barbero } from '../domain/barbero';
import { DatoInvalido, NoEncontrado } from '../domain/errores';
import { LimiteBarberos } from '../domain/limite-barberos';
import { AutorizacionCatalogoCitas } from './autorizacion';
import { aBarberoVista, type BarberoVista, exigirConfirmacion } from './comun';
import { BarberoRepository, CitasActivasQuery, ServicioRepository } from './ports/catalogo-repositorios';

export interface DatosNuevoBarbero {
  nombre: string;
  servicioIds: readonly string[];
  usuarioId?: string | null;
}

export interface CambiosBarbero {
  nombre?: string;
  servicioIds?: readonly string[];
  usuarioId?: string | null;
  activo?: boolean;
  confirmarConflictos?: boolean;
}

/**
 * Reglas compartidas por crear y editar: los servicios deben ser de la barbería (400 si no) y el usuario
 * vinculado debe ser personal ACTIVO de la barbería (404 si no: no se revela si existe en otra).
 */
@Injectable()
export class ReglasBarbero {
  constructor(
    private readonly servicios: ServicioRepository,
    private readonly personal: PersonalApi,
    private readonly barberos: BarberoRepository,
    private readonly suscripciones: SuscripcionesApi,
  ) {}

  async validarServicios(servicioIds: readonly string[]): Promise<void> {
    const unicos = [...new Set(servicioIds)];
    const existentes = await this.servicios.existentes(unicos);
    if (existentes.length !== unicos.length) throw new DatoInvalido('servicioIds', 'no_existe');
  }

  async validarUsuario(usuarioId: string | null | undefined): Promise<void> {
    if (usuarioId && !(await this.personal.esPersonalActivo(usuarioId))) throw new NoEncontrado();
  }

  /** Límite del plan (R13): M03 bloquea la suscripción hasta el final de la transacción. */
  async exigirCupo(tenantId: TenantId): Promise<void> {
    const maximo = await this.suscripciones.obtenerLimiteBarberos(tenantId);
    LimiteBarberos.exigir(await this.barberos.contarActivos(), maximo);
  }
}

/** T056 · Barberos de la barbería con sus servicios (PROPIETARIO y BARBERO). */
@Injectable()
export class ListarBarberos {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly barberos: BarberoRepository,
  ) {}

  async ejecutar(actor: Actor): Promise<BarberoVista[]> {
    await this.autorizacion.exigir(actor, 'VER_CATALOGO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () =>
      (await this.barberos.listar()).map(aBarberoVista),
    );
  }
}

/** T056 · Crear un barbero (RF08; FR-009, FR-010, FR-012) dentro del límite del plan. */
@Injectable()
export class CrearBarbero {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly barberos: BarberoRepository,
    private readonly reglas: ReglasBarbero,
  ) {}

  async ejecutar(actor: Actor, datos: DatosNuevoBarbero): Promise<BarberoVista> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_BARBEROS');
    const barbero = Barbero.crear(uuidv7(), {
      nombre: datos.nombre,
      usuarioId: datos.usuarioId ?? null,
      servicioIds: datos.servicioIds,
    });
    const tenantId = TenantId.de(actor.tenantId);
    return this.uow.ejecutar(tenantId, async () => {
      await this.reglas.validarServicios(barbero.servicioIds);
      await this.reglas.validarUsuario(barbero.usuarioId);
      await this.reglas.exigirCupo(tenantId);
      await this.barberos.crear(barbero);
      return aBarberoVista(barbero);
    });
  }
}

/**
 * T056 · Editar nombre, servicios, vínculo o estado de un barbero (FR-009 a FR-012). Desactivarlo con citas
 * futuras sigue la confirmación en dos pasos (R11) y conserva su historial; reactivarlo respeta el límite.
 * Desactivar al usuario vinculado (001) no lo desactiva: solo lo hace el propietario aquí.
 */
@Injectable()
export class ActualizarBarbero {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly barberos: BarberoRepository,
    private readonly reglas: ReglasBarbero,
    private readonly citas: CitasActivasQuery,
    private readonly barberias: BarberiasApi,
    private readonly reloj: Clock,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, id: string, cambios: CambiosBarbero): Promise<BarberoVista> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_BARBEROS');
    const { confirmarConflictos, ...resto } = cambios;
    if (Object.values(resto).every((v) => v === undefined)) throw new DatoInvalido('cuerpo', 'sin_cambios');
    const tenantId = TenantId.de(actor.tenantId);

    return this.uow.ejecutar(tenantId, async () => {
      const barbero = await this.barberos.porId(id);
      if (!barbero) throw new NoEncontrado();

      if (cambios.nombre !== undefined) barbero.renombrar(cambios.nombre);
      if (cambios.servicioIds !== undefined) {
        await this.reglas.validarServicios(cambios.servicioIds);
        barbero.reemplazarServicios(cambios.servicioIds);
      }
      if (cambios.usuarioId !== undefined) {
        await this.reglas.validarUsuario(cambios.usuarioId);
        barbero.vincular(cambios.usuarioId);
      }

      const desactiva = cambios.activo === false && barbero.activo;
      if (desactiva) {
        const zona = new ZonaHoraria((await this.barberias.configuracionAgenda()).zonaHoraria);
        const futuras = await this.citas.futuras({ barberoId: id }, this.reloj.ahora());
        exigirConfirmacion(futuras, confirmarConflictos, zona);
        barbero.desactivar();
      } else if (cambios.activo === true && !barbero.activo) {
        await this.reglas.exigirCupo(tenantId);
        barbero.reactivar();
      }

      await this.barberos.actualizar(barbero);
      if (desactiva) {
        await this.auditoria.registrar({
          accion: 'BARBERO_DESACTIVADO',
          actorId: actor.usuarioId,
          recurso: `barbero:${id}`,
          resultado: 'PERMITIDO',
        });
      }
      return aBarberoVista(barbero);
    });
  }
}
