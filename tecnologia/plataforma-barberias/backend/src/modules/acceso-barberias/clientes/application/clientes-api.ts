import { Injectable } from '@nestjs/common';
import { ClientesApi, type ContactoParaAvisos, type PerfilClienteResumen } from '../../api-publica';
import { PerfilClienteRepository } from './ports/perfil-cliente-repository';

/**
 * T090 · Implementación de `ClientesApi` (interfaz pública de M01 para M02, ADR-020). Participa en la
 * transacción del caso de uso de M02, con el tenant del token ya fijado.
 */
@Injectable()
export class ClientesApiImpl extends ClientesApi {
  constructor(private readonly perfiles: PerfilClienteRepository) {
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

  /** 004 (M05, T068): fase 3, siempre el correo; el canal elegido y WhatsApp llegan en la fase 5. */
  async contactoParaAvisos(clienteId: string): Promise<ContactoParaAvisos | null> {
    const perfil = await this.perfiles.correoDe(clienteId);
    return perfil ? { correo: perfil.correo, canal: 'CORREO' } : null;
  }
}
