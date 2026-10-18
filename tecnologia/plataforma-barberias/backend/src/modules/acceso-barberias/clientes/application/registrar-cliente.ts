import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Configuracion, TenantContext, UnitOfWork } from '../../../../shared';
import { BarberiasApi } from '../../api-publica';
import { EmitirSesion } from '../../identidad/application/emitir-sesion';
import { PasswordHasher } from '../../identidad/application/ports/password-hasher';
import { UsuarioRepository } from '../../identidad/application/ports/usuario-repository';
import type { SesionIniciada } from '../../identidad/application/sesion-iniciada';
import { Contrasena } from '../../identidad/domain/contrasena';
import { Correo } from '../../identidad/domain/correo';
import { Membresia } from '../../identidad/domain/membresia';
import { NombrePersona } from '../../identidad/domain/nombre-persona';
import { Consentimiento } from '../domain/consentimiento';
import { PerfilCliente, Telefono } from '../domain/perfil-cliente';
import { ConsentimientoRepository } from './ports/consentimiento-repository';
import { PerfilClienteRepository } from './ports/perfil-cliente-repository';

export interface ComandoRegistrarCliente {
  barberia: string;
  nombre: string;
  correo: string;
  telefono: string;
  contrasena: string;
  aceptaPoliticaDatos: boolean;
  versionPoliticaDatos: string;
}

/**
 * T085 · Registro de un cliente desde el enlace de una barbería (RF05, HU06; FR-023 a FR-025; ADR-020).
 * El `slug` solo elige la barbería donde se crea la membresía (constitución 1.2.0, selección de membresía
 * por enlace). En UNA transacción crea la cuenta, la membresía CLIENTE, el perfil y el consentimiento, lo
 * audita y abre la sesión del cliente en esa barbería. Sin aceptación de la política no se guarda nada.
 */
@Injectable()
export class RegistrarCliente {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly barberias: BarberiasApi,
    private readonly usuarios: UsuarioRepository,
    private readonly perfiles: PerfilClienteRepository,
    private readonly consentimientos: ConsentimientoRepository,
    private readonly hasher: PasswordHasher,
    private readonly emitirSesion: EmitirSesion,
    private readonly auditoria: AuditLog,
    private readonly configuracion: Configuracion,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(comando: ComandoRegistrarCliente): Promise<SesionIniciada> {
    // Validaciones antes de tocar la base: sin consentimiento vigente no se guarda ningún dato (FR-023).
    const consentimiento = Consentimiento.enLinea(
      comando.aceptaPoliticaDatos,
      comando.versionPoliticaDatos,
      this.configuracion.versionPoliticaDatos,
    );
    const correo = Correo.crear(comando.correo);
    const nombre = NombrePersona.crear(comando.nombre);
    const telefono = Telefono.crear(comando.telefono);
    const contrasena = Contrasena.crear(comando.contrasena, correo);
    const tenantId = await this.barberias.resolverSlugPublico(comando.barberia);
    // El hash es lento a propósito: fuera de la transacción.
    const hashContrasena = await this.hasher.hash(contrasena);

    return this.uow.ejecutar(tenantId, async () => {
      const usuarioId = uuidv7();
      // Sin RETURNING (ADR-015). Un correo existente → CorreoNoDisponible, sin revelar barberías.
      await this.usuarios.crearCuenta({ id: usuarioId, correo, nombre, hashContrasena });
      await this.usuarios.crearMembresia(Membresia.crearCliente(uuidv7(), tenantId.valor, usuarioId));
      const perfil = PerfilCliente.enLinea({
        id: uuidv7(),
        tenantId: tenantId.valor,
        usuarioId,
        nombre,
        correo,
        telefono,
      });
      await this.perfiles.crear(perfil);
      await this.consentimientos.registrar(
        perfil.id,
        consentimiento,
        this.tenantContext.datosSolicitud().ip ?? null,
      );
      await this.auditoria.registrar({
        accion: 'CLIENTE_REGISTRADO',
        actorId: usuarioId,
        recurso: `cliente:${perfil.id}`,
        resultado: 'PERMITIDO',
      });
      const sesion = await this.emitirSesion.ejecutar(usuarioId, 'CLIENTE');
      const usuario = await this.usuarios.perfil(usuarioId);
      if (!usuario) throw new Error('El cliente recién registrado no es visible en su barbería');
      return { sesion, usuario };
    });
  }
}
