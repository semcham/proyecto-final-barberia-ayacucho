import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Clock, TenantId, UnitOfWork } from '../../../../shared';
import { BarberiasApi } from '../../api-publica';
import { type Actor, Autorizacion } from '../../identidad/application/autorizacion';
import { NoAutenticado } from '../../identidad/domain/errores';
import {
  type ConsentimientoVigente,
  type DecisionDeCanal,
  decidirCambioDeCanal,
  type PedidoDeCanal,
  retirarConsentimiento,
} from '../domain/consentimiento-whatsapp';
import { numeroOculto, PREFERENCIA_POR_DEFECTO, type PreferenciaAviso } from '../domain/preferencia-aviso';
import { textoParaLaBarberia, VERSION_TEXTO_WHATSAPP } from '../domain/texto-consentimiento-whatsapp';
import { ConsentimientoWhatsappRepository } from './ports/consentimiento-whatsapp-repository';
import { PerfilClienteRepository } from './ports/perfil-cliente-repository';
import { PreferenciaAvisoRepository } from './ports/preferencia-aviso-repository';

/** Esquema PreferenciaAviso de contracts/openapi.yaml (004). */
export interface VistaPreferenciaAviso {
  canal: 'CORREO' | 'WHATSAPP';
  numeroWhatsapp: string | null;
  /** El teléfono de contacto del perfil, para proponerlo (FR-017). */
  numeroPropuesto: string;
  consentimientoVigente: boolean;
  aceptadoEn: string | null;
  textoConsentimiento: { version: string; texto: string };
}

/**
 * T118 de 004 · Canal de aviso del cliente con sesión en la barbería del token (RF33; FR-016 a FR-018, FR-035):
 * obtener, cambiar y retirar el consentimiento de WhatsApp. Solo CLIENTE, y solo su propio perfil (el de la sesión).
 * Cada barbería tiene su propio canal y su propio consentimiento (US4-6). Auditoría en la misma transacción, sin el
 * número completo: CANAL_AVISO_CAMBIADO, CONSENTIMIENTO_WHATSAPP_ACEPTADO (con la versión del texto) y
 * CONSENTIMIENTO_WHATSAPP_RETIRADO. Un pedido rechazado no cambia ni audita nada.
 */
@Injectable()
export class CanalDeAvisoDelCliente {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly perfiles: PerfilClienteRepository,
    private readonly preferencias: PreferenciaAvisoRepository,
    private readonly consentimientos: ConsentimientoWhatsappRepository,
    private readonly barberias: BarberiasApi,
    private readonly auditoria: AuditLog,
    private readonly reloj: Clock,
  ) {}

  async obtener(actor: Actor): Promise<VistaPreferenciaAviso> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_CANAL_AVISO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const { clienteId, telefono } = await this.perfilDe(actor);
      return this.vista(clienteId, telefono);
    });
  }

  async cambiar(actor: Actor, pedido: PedidoDeCanal): Promise<VistaPreferenciaAviso> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_CANAL_AVISO');
    return this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const { clienteId, telefono } = await this.perfilDe(actor);
      const actual = (await this.preferencias.obtener(clienteId)) ?? PREFERENCIA_POR_DEFECTO;
      const vigente = await this.consentimientos.vigente(clienteId);
      const decision = decidirCambioDeCanal({
        actual,
        vigente,
        pedido,
        versionVigente: VERSION_TEXTO_WHATSAPP,
        ahora: this.reloj.ahora(),
        nuevoId: uuidv7(),
      });
      await this.aplicar(actor, clienteId, actual, vigente, decision);
      return this.vista(clienteId, telefono);
    });
  }

  async retirar(actor: Actor): Promise<void> {
    await this.autorizacion.exigir(actor, 'GESTIONAR_CANAL_AVISO');
    await this.uow.ejecutar(TenantId.de(actor.tenantId), async () => {
      const { clienteId } = await this.perfilDe(actor);
      const actual = (await this.preferencias.obtener(clienteId)) ?? PREFERENCIA_POR_DEFECTO;
      const vigente = await this.consentimientos.vigente(clienteId);
      const decision = retirarConsentimiento({ actual, vigente, ahora: this.reloj.ahora() });
      await this.aplicar(actor, clienteId, actual, vigente, decision);
    });
  }

  /** Guarda la decisión: retiro, consentimiento nuevo y preferencia, cada cambio con su entrada de auditoría. */
  private async aplicar(
    actor: Actor,
    clienteId: string,
    actual: PreferenciaAviso,
    vigente: ConsentimientoVigente | null,
    decision: DecisionDeCanal,
  ): Promise<void> {
    const recurso = (extra: string) => `cliente:${clienteId};${extra}`;
    if (decision.retirar && vigente) {
      await this.consentimientos.retirar(decision.retirar.id, decision.retirar.en);
      await this.auditar(
        actor,
        'CONSENTIMIENTO_WHATSAPP_RETIRADO',
        recurso(`numero=${numeroOculto(vigente.numero)}`),
      );
    }
    if (decision.aceptar) {
      await this.consentimientos.registrar(clienteId, decision.aceptar);
      await this.auditar(
        actor,
        'CONSENTIMIENTO_WHATSAPP_ACEPTADO',
        recurso(`version=${decision.aceptar.version};numero=${numeroOculto(decision.aceptar.numero)}`),
      );
    }
    const cambioPreferencia =
      actual.canal !== decision.preferencia.canal || actual.numero !== decision.preferencia.numero;
    if (cambioPreferencia) await this.preferencias.guardar(clienteId, decision.preferencia);
    if (decision.canalCambio) {
      await this.auditar(actor, 'CANAL_AVISO_CAMBIADO', recurso(`canal=${decision.preferencia.canal}`));
    }
  }

  private auditar(
    actor: Actor,
    accion: 'CANAL_AVISO_CAMBIADO' | 'CONSENTIMIENTO_WHATSAPP_ACEPTADO' | 'CONSENTIMIENTO_WHATSAPP_RETIRADO',
    recurso: string,
  ): Promise<void> {
    return this.auditoria.registrar({ accion, actorId: actor.usuarioId, recurso, resultado: 'PERMITIDO' });
  }

  /** El perfil de cliente de la sesión en esta barbería; sin perfil, la sesión no es válida para esto. */
  private async perfilDe(actor: Actor): Promise<{ clienteId: string; telefono: string }> {
    const perfil = await this.perfiles.porUsuario(actor.usuarioId);
    if (!perfil) throw new NoAutenticado();
    return { clienteId: perfil.clienteId, telefono: perfil.telefono };
  }

  private async vista(clienteId: string, telefono: string): Promise<VistaPreferenciaAviso> {
    const preferencia = (await this.preferencias.obtener(clienteId)) ?? PREFERENCIA_POR_DEFECTO;
    const vigente = await this.consentimientos.vigente(clienteId);
    const valeParaElNumero =
      vigente !== null && preferencia.numero !== null && vigente.numero === preferencia.numero;
    return {
      canal: preferencia.canal,
      numeroWhatsapp: preferencia.numero,
      numeroPropuesto: telefono,
      consentimientoVigente: valeParaElNumero,
      aceptadoEn: valeParaElNumero ? (vigente as ConsentimientoVigente).aceptadoEn.toISOString() : null,
      textoConsentimiento: {
        version: VERSION_TEXTO_WHATSAPP,
        texto: textoParaLaBarberia(await this.barberias.nombre()),
      },
    };
  }
}
