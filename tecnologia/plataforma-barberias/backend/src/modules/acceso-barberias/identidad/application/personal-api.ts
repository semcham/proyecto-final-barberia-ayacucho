import { Injectable } from '@nestjs/common';
import { PersonalApi } from '../../api-publica';
import { UsuarioRepository } from './ports/usuario-repository';

/**
 * T052 · Implementación de `PersonalApi` (interfaz pública de M01 para M02, ADR-020). Se usa dentro de la
 * transacción del caso de uso de M02, con el tenant del token fijado: la membresía se lee con RLS, así que
 * un usuario de otra barbería simplemente no existe.
 */
@Injectable()
export class PersonalApiImpl extends PersonalApi {
  constructor(private readonly usuarios: UsuarioRepository) {
    super();
  }

  async esPersonalActivo(usuarioId: string): Promise<boolean> {
    const membresia = await this.usuarios.membresiaEnContexto(usuarioId);
    return (
      membresia !== null &&
      membresia.estado === 'ACTIVA' &&
      (membresia.rol.codigo === 'PROPIETARIO' || membresia.rol.codigo === 'BARBERO')
    );
  }
}
