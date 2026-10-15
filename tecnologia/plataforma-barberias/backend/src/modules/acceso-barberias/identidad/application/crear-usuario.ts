import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, TenantId, UnitOfWork } from '../../../../shared';
import { SuscripcionesApi } from '../../../suscripciones-pagos';
import { Correo } from '../domain/correo';
import { ValorInvalido } from '../domain/errores';
import { LimiteUsuarios } from '../domain/limite-usuarios';
import { Membresia } from '../domain/membresia';
import { NombrePersona } from '../domain/nombre-persona';
import { Rol } from '../domain/rol';
import { type Actor, Autorizacion } from './autorizacion';
import { type EnlaceActivacion, GenerarEnlaceActivacion } from './enlace-activacion';
import { type UsuarioDetalle, UsuarioRepository } from './ports/usuario-repository';

export interface ComandoCrearUsuario {
  nombre: string;
  correo: string;
  rol: string;
}

export interface UsuarioCreado {
  usuario: UsuarioDetalle;
  activacion: EnlaceActivacion;
}

/**
 * El propietario crea un usuario del personal con rol BARBERO (RF06, HU04; FR-015 a FR-017, FR-020,
 * FR-022). El usuario nace PENDIENTE y fija su contraseña con un enlace de un solo uso.
 */
@Injectable()
export class CrearUsuario {
  constructor(
    private readonly autorizacion: Autorizacion,
    private readonly uow: UnitOfWork,
    private readonly usuarios: UsuarioRepository,
    private readonly suscripciones: SuscripcionesApi,
    private readonly generarEnlace: GenerarEnlaceActivacion,
    private readonly auditoria: AuditLog,
  ) {}

  async ejecutar(actor: Actor, comando: ComandoCrearUsuario): Promise<UsuarioCreado> {
    await this.autorizacion.exigir(actor, 'CREAR_USUARIO');

    const rol = Rol.de(comando.rol);
    if (!rol.esAsignablePorPropietario()) throw new ValorInvalido('rol', 'no_permitido');
    const correo = Correo.crear(comando.correo);
    const nombre = NombrePersona.crear(comando.nombre);
    const tenantId = TenantId.de(actor.tenantId);

    return this.uow.ejecutar(tenantId, async () => {
      const maximo = await this.suscripciones.obtenerLimiteUsuarios(tenantId);
      LimiteUsuarios.exigir(await this.usuarios.contarPersonalVigente(), maximo);

      const usuarioId = uuidv7();
      await this.usuarios.crearCuenta({ id: usuarioId, correo, nombre, hashContrasena: null });
      await this.usuarios.crearMembresia(
        Membresia.crearBarberoPendiente(uuidv7(), tenantId.valor, usuarioId),
      );
      const activacion = await this.generarEnlace.ejecutar(tenantId.valor, usuarioId, actor.usuarioId);

      await this.auditoria.registrar({
        accion: 'USUARIO_CREADO',
        actorId: actor.usuarioId,
        recurso: `usuario:${usuarioId}`,
        resultado: 'PERMITIDO',
      });

      const usuario = await this.usuarios.obtener(usuarioId);
      if (!usuario) throw new Error('El usuario recién creado no es visible en su barbería');
      return { usuario, activacion };
    });
  }
}
