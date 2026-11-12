import { Injectable } from '@nestjs/common';
import { ClientesApi, type ContactoParaAvisos, type PerfilClienteResumen } from '../../api-publica';
import { PREFERENCIA_POR_DEFECTO } from '../domain/preferencia-aviso';
import { ConsentimientoWhatsappRepository } from './ports/consentimiento-whatsapp-repository';
import { PerfilClienteRepository } from './ports/perfil-cliente-repository';
import { PreferenciaAvisoRepository } from './ports/preferencia-aviso-repository';

/**
 * T090 · Implementación de `ClientesApi` (interfaz pública de M01 para M02, ADR-020). Participa en la
 * transacción del caso de uso de M02, con el tenant del token ya fijado.
 */
@Injectable()
export class ClientesApiImpl extends ClientesApi {
  constructor(
    private readonly perfiles: PerfilClienteRepository,
    private readonly preferencias: PreferenciaAvisoRepository,
    private readonly consentimientos: ConsentimientoWhatsappRepository,
  ) {
    super();
  }

  perfilDeSesion(usuarioId: string): Promise<PerfilClienteResumen | null> {
    return this.perfiles.porUsuario(usuarioId);
  }

  // Lo usan la agenda (US4) y la cita presencial (US4); su prueba de punta a punta llega con esa historia.
  datosDeContacto(clienteIds: readonly string[]): Promise<PerfilClienteResumen[]> {
    return this.perfiles.varios(clienteIds);
  }

  perfilDeBarberia(clienteId: string): Promise<PerfilClienteResumen | null> {
    return this.perfiles.porId(clienteId);
  }

  /**
   * 004 (M05; T068, T119; research R12): el correo, el canal elegido, el número de WhatsApp y si hay un
   * consentimiento VIGENTE para ese número (FR-019). Se lee al enviar cada aviso: un retiro intermedio se respeta.
   */
  async contactoParaAvisos(clienteId: string): Promise<ContactoParaAvisos | null> {
    const perfil = await this.perfiles.correoDe(clienteId);
    if (!perfil) return null;
    const preferencia = (await this.preferencias.obtener(clienteId)) ?? PREFERENCIA_POR_DEFECTO;
    const vigente = await this.consentimientos.vigente(clienteId);
    return {
      correo: perfil.correo,
      canal: preferencia.canal,
      numeroWhatsapp: preferencia.numero,
      consentimientoVigente:
        vigente !== null && preferencia.numero !== null && vigente.numero === preferencia.numero,
    };
  }
}
