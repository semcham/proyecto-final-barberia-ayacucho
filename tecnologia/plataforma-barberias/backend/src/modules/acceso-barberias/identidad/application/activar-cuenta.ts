import { Injectable } from '@nestjs/common';
import { Clock, TenantId, UnitOfWork } from '../../../../shared';
import { Contrasena } from '../domain/contrasena';
import { Correo } from '../domain/correo';
import { EnlaceInvalido } from '../domain/errores';
import { ActivacionRepository } from './ports/activacion-repository';
import { PasswordHasher } from './ports/password-hasher';
import { UsuarioRepository } from './ports/usuario-repository';
import { hashDeToken } from './tokens-opacos';

/**
 * El usuario creado por el propietario fija su contraseña con el enlace de un solo uso (FR-022). Operación
 * pública: el token del enlace es la credencial. Cualquier problema con el enlace responde ENLACE_INVALIDO.
 */
@Injectable()
export class ActivarCuenta {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly activaciones: ActivacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly hasher: PasswordHasher,
    private readonly reloj: Clock,
  ) {}

  async ejecutar(token: string, contrasenaTexto: string): Promise<void> {
    // ADR-015: el tenant aún no se conoce; se resuelve por el hash del token.
    const activacion = await this.uow.ejecutarSinTenant(() =>
      this.activaciones.buscarPorHash(hashDeToken(token)),
    );
    if (!activacion) throw new EnlaceInvalido();

    await this.uow.ejecutar(TenantId.de(activacion.tenantId), async () => {
      activacion.usar(this.reloj.ahora());
      const usuario = await this.usuarios.obtener(activacion.usuarioId);
      const membresia = await this.usuarios.obtenerMembresia(activacion.usuarioId);
      if (!usuario || !membresia || membresia.estado !== 'PENDIENTE') throw new EnlaceInvalido();

      const contrasena = Contrasena.crear(contrasenaTexto, Correo.crear(usuario.correo));
      // Si otra solicitud usó el mismo enlace al mismo tiempo, esta pierde.
      if (!(await this.activaciones.marcarUsada(activacion))) throw new EnlaceInvalido();
      await this.usuarios.fijarContrasena(activacion.usuarioId, await this.hasher.hash(contrasena));
      membresia.activar();
      await this.usuarios.actualizarEstado(membresia);
    });
  }
}
