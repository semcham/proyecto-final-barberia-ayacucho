import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { SuscripcionesApi } from '../../suscripciones-api';
import {
  type ActorDeBarberia,
  AutorizacionSuscripciones,
} from '../../suscripciones/application/autorizacion';
import { NoEncontrado } from '../../suscripciones/domain/errores';
import { tipoDeArchivoDeAdelanto } from '../domain/archivo-adelanto';
import {
  type CambioDeConfiguracion,
  type ConfiguracionAdelanto,
  ConfiguracionDeAdelanto,
} from '../domain/configuracion-adelanto';
import type { TipoAdelanto } from '../domain/politica-adelanto';
import { type ArchivoAdelanto, ArchivosAdelanto } from './ports/archivos-adelanto';
import { ConfiguracionAdelantoRepository } from './ports/configuracion-adelanto-repository';

/** La configuración como la ve el propietario (contracts/openapi.yaml de 008, ConfiguracionAdelanto). */
export interface ConfiguracionAdelantoVista {
  activo: boolean;
  tipo?: TipoAdelanto;
  montoCentimos?: number;
  porcentaje?: number;
  plazoMinutos?: number;
  tieneQr: boolean;
  actualizadoEn?: Date;
}

/** Solo los datos que existen, y nunca el id ni una dirección del QR: el QR se pide aparte, con sesión. */
function aVista(c: ConfiguracionAdelanto): ConfiguracionAdelantoVista {
  return {
    activo: c.activo,
    ...(c.tipo !== null ? { tipo: c.tipo } : {}),
    ...(c.montoCentimos !== null ? { montoCentimos: c.montoCentimos } : {}),
    ...(c.porcentaje !== null ? { porcentaje: c.porcentaje } : {}),
    ...(c.plazoMinutos !== null ? { plazoMinutos: c.plazoMinutos } : {}),
    tieneQr: c.qrArchivoId !== null,
    ...(c.actualizadoEn !== null ? { actualizadoEn: c.actualizadoEn } : {}),
  };
}

/**
 * T017 de 008 · El propietario configura el adelanto de su barbería (US1; FR-001 a FR-004, FR-029, FR-030):
 * - todo exige CONFIGURAR_ADELANTO (solo el propietario, contracts/rbac.md), con la barbería del token;
 * - cambiar la configuración y subir el QR exigen además que la suscripción permita CONFIGURAR_CATALOGO
 *   (research R12) y dejan una entrada ADELANTO_CONFIGURADO, sin datos del QR;
 * - el QR se verifica por sus bytes (JPEG o PNG, hasta 1 MB) antes de abrir la transacción y queda privado;
 *   reemplazarlo guarda otro archivo y conserva el anterior para las citas ya reservadas (FR-004);
 * - los cambios valen para las reservas nuevas: aquí no se toca ningún adelanto ya creado.
 */
@Injectable()
export class ConfigurarAdelanto {
  constructor(
    private readonly autorizacion: AutorizacionSuscripciones,
    private readonly uow: UnitOfWork,
    private readonly configuraciones: ConfiguracionAdelantoRepository,
    private readonly archivos: ArchivosAdelanto,
    private readonly suscripciones: SuscripcionesApi,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async obtener(actor: ActorDeBarberia): Promise<ConfiguracionAdelantoVista> {
    await this.autorizacion.exigir(actor, 'CONFIGURAR_ADELANTO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () =>
      aVista((await this.configuraciones.actual()) ?? ConfiguracionDeAdelanto.sinConfigurar()),
    );
  }

  async cambiar(actor: ActorDeBarberia, cambio: CambioDeConfiguracion): Promise<ConfiguracionAdelantoVista> {
    await this.autorizacion.exigir(actor, 'CONFIGURAR_ADELANTO');
    const tenant = TenantId.de(actor.tenantId);
    return this.uow.ejecutar(tenant, async () => {
      await this.suscripciones.exigirOperacion(tenant, 'CONFIGURAR_CATALOGO');
      const guardada = await this.configuraciones.actual({ bloquear: true });
      const valores = ConfiguracionDeAdelanto.aplicar(guardada, cambio);
      const nueva = await this.configuraciones.guardar(
        valores,
        guardada?.qrArchivoId ?? null,
        actor.usuarioId,
        this.reloj.ahora(),
      );
      await this.auditoria.registrar({
        accion: 'ADELANTO_CONFIGURADO',
        actorId: actor.usuarioId,
        recurso: `adelanto:${nueva.activo ? 'ACTIVO' : 'INACTIVO'}`,
        resultado: 'PERMITIDO',
      });
      return aVista(nueva);
    });
  }

  async subirQr(actor: ActorDeBarberia, contenido: Buffer): Promise<ConfiguracionAdelantoVista> {
    await this.autorizacion.exigir(actor, 'CONFIGURAR_ADELANTO');
    // Antes de la transacción: lo inválido se descarta sin tocar la base.
    tipoDeArchivoDeAdelanto('QR', contenido);
    const tenant = TenantId.de(actor.tenantId);
    return this.uow.ejecutar(tenant, async () => {
      await this.suscripciones.exigirOperacion(tenant, 'CONFIGURAR_CATALOGO');
      await this.configuraciones.actual({ bloquear: true });
      const archivoId = await this.archivos.guardar({
        id: uuidv7(),
        clase: 'QR',
        contenido,
        por: actor.usuarioId,
      });
      const nueva = await this.configuraciones.fijarQr(archivoId, actor.usuarioId, this.reloj.ahora());
      await this.auditoria.registrar({
        accion: 'ADELANTO_CONFIGURADO',
        actorId: actor.usuarioId,
        recurso: 'adelanto:QR',
        resultado: 'PERMITIDO',
      });
      return aVista(nueva);
    });
  }

  /** El QR vigente de la barbería, para el propietario (404 si todavía no subió uno). */
  async verQr(actor: ActorDeBarberia): Promise<ArchivoAdelanto> {
    await this.autorizacion.exigir(actor, 'CONFIGURAR_ADELANTO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const configuracion = await this.configuraciones.actual();
      const archivo = configuracion?.qrArchivoId ? await this.archivos.leer(configuracion.qrArchivoId) : null;
      if (!archivo) throw new NoEncontrado();
      return archivo;
    });
  }
}
