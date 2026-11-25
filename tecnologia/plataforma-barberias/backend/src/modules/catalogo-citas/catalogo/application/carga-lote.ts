import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import type { Actor } from '../../../acceso-barberias';
import { SuscripcionesApi } from '../../../suscripciones-pagos';
import { AuditLog, TenantId, UnitOfWork } from '../../../../shared';
import {
  type FilaServicio,
  MAX_FILAS_LOTE,
  type RevisionDeCarga,
  revisarServicios,
} from '../domain/carga-lote';
import { CargaInvalida, DatoInvalido, IdempotenciaDeCargaConflicto } from '../domain/errores';
import { Servicio } from '../domain/servicio';
import { AutorizacionCatalogoCitas } from './autorizacion';
import { InvalidadorCatalogoPublico } from './invalidador-catalogo-publico';
import {
  type CargaGuardada,
  CargaLoteRepository,
  ClaveDeCargaEnUso,
  ServicioRepository,
} from './ports/catalogo-repositorios';

// 011 · Carga en lote del catálogo (research R01 a R08). La revisión y el guardado usan las MISMAS reglas que la
// creación individual (`problemasDeServicio` dentro de `revisarServicios`); el guardado repite la revisión dentro de la
// transacción y es todo o nada.

const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type TipoDeCarga = 'SERVICIOS' | 'BARBEROS';

/** Resumen de una carga guardada (o del reintento de una ya guardada). */
export interface ResumenCarga {
  tipo: TipoDeCarga;
  creados: number;
  ids: string[];
  /** false cuando un reintento con la misma Idempotency-Key devuelve la carga ya guardada (200). */
  creada: boolean;
}

export type RevisionVista = RevisionDeCarga;

function exigirTamano(filas: readonly unknown[]): void {
  if (filas.length < 1 || filas.length > MAX_FILAS_LOTE) throw new DatoInvalido('filas', 'cantidad');
}

function exigirClave(clave: string | undefined): string {
  if (!clave || !FORMATO_UUID.test(clave)) throw new DatoInvalido('Idempotency-Key', 'formato');
  return clave.toLowerCase();
}

/** Huella de las filas normalizadas: distingue el reintento del mismo envío de otra carga con la misma clave. */
function huellaDe(tipo: TipoDeCarga, filas: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify({ tipo, filas })).digest('hex');
}

/** T021 · Revisa una carga de servicios sin guardar nada (vista previa, FR-010). */
@Injectable()
export class RevisarCargaServicios {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly servicios: ServicioRepository,
    private readonly suscripciones: SuscripcionesApi,
  ) {}

  async ejecutar(actor: Actor, filas: readonly FilaServicio[]): Promise<RevisionVista> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_SERVICIOS');
    exigirTamano(filas);
    const tenantId = TenantId.de(actor.tenantId);
    return this.uow.ejecutar(tenantId, async () => {
      // FR-017: con la suscripción vencida o suspendida, el catálogo es de solo lectura (como en la creación).
      await this.suscripciones.exigirOperacion(tenantId, 'CONFIGURAR_CATALOGO');
      const existentes = await this.servicios.nombresExistentes(filas.map((f) => f.nombre));
      const { filas: cantidad, errores, advertencias } = revisarServicios(filas, existentes);
      return { filas: cantidad, errores, advertencias };
    });
  }
}

/**
 * T021 · Crea todos los servicios de una carga o ninguno (FR-001, FR-011 a FR-014, FR-020, FR-021). Reintentos con la
 * misma Idempotency-Key devuelven el mismo resumen (research R06).
 */
@Injectable()
export class CargarServicios {
  constructor(
    private readonly autorizacion: AutorizacionCatalogoCitas,
    private readonly uow: UnitOfWork,
    private readonly servicios: ServicioRepository,
    private readonly cargas: CargaLoteRepository,
    private readonly suscripciones: SuscripcionesApi,
    private readonly auditoria: AuditLog,
    private readonly invalidador: InvalidadorCatalogoPublico,
  ) {}

  async ejecutar(
    actor: Actor,
    filas: readonly FilaServicio[],
    claveRecibida: string | undefined,
  ): Promise<ResumenCarga> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_SERVICIOS');
    const clave = exigirClave(claveRecibida);
    exigirTamano(filas);
    const tenantId = TenantId.de(actor.tenantId);
    const huella = huellaDe('SERVICIOS', filas);
    try {
      return await this.uow.ejecutar(tenantId, () => this.cargar(actor, tenantId, filas, clave, huella));
    } catch (error) {
      // Dos reintentos a la vez: el segundo choca con el índice de la carga que el primero acaba de guardar. En una
      // transacción nueva se devuelve esa carga (patrón R09 de 002).
      if (error instanceof ClaveDeCargaEnUso) {
        const previa = await this.uow.ejecutar(tenantId, () => this.cargas.buscar(actor.usuarioId, clave));
        if (previa) return resumenDePrevia(previa, 'SERVICIOS', huella);
      }
      throw error;
    }
  }

  private async cargar(
    actor: Actor,
    tenantId: TenantId,
    filas: readonly FilaServicio[],
    clave: string,
    huella: string,
  ): Promise<ResumenCarga> {
    const previa = await this.cargas.buscar(actor.usuarioId, clave);
    if (previa) return resumenDePrevia(previa, 'SERVICIOS', huella);

    await this.suscripciones.exigirOperacion(tenantId, 'CONFIGURAR_CATALOGO');
    const existentes = await this.servicios.nombresExistentes(filas.map((f) => f.nombre));
    const revision = revisarServicios(filas, existentes);
    if (revision.errores.length > 0) throw new CargaInvalida(revision.errores);

    const nuevos = revision.utiles.map((u) => Servicio.crear(uuidv7(), u.datos));
    // El índice service_nombre_unico es la garantía final: si otra carga ganó un nombre, todo se revierte.
    await this.servicios.crearVarios(nuevos);
    const carga: CargaGuardada = {
      id: uuidv7(),
      autorId: actor.usuarioId,
      clave,
      tipo: 'SERVICIOS',
      huella,
      ids: nuevos.map((s) => s.id),
    };
    await this.cargas.guardar(carga);
    await this.auditoria.registrar({
      accion: 'SERVICIOS_CARGADOS_EN_LOTE',
      actorId: actor.usuarioId,
      recurso: `lote:${carga.id};cantidad=${nuevos.length}`,
      resultado: 'PERMITIDO',
    });
    this.invalidador.catalogoCambio(tenantId);
    return { tipo: 'SERVICIOS', creados: nuevos.length, ids: carga.ids, creada: true };
  }
}

/** La misma clave con el mismo tipo y las mismas filas es un reintento; si no, la clave ya se usó con otra carga. */
function resumenDePrevia(previa: CargaGuardada, tipo: TipoDeCarga, huella: string): ResumenCarga {
  if (previa.tipo !== tipo || previa.huella !== huella) throw new IdempotenciaDeCargaConflicto();
  return { tipo, creados: previa.ids.length, ids: previa.ids, creada: false };
}
