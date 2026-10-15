import { Injectable } from '@nestjs/common';
import { Clock, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { AccesoSuspendido, CredencialesInvalidas, DemasiadosIntentos } from '../domain/errores';
import { HISTORIAL_MS, PoliticaIntentos } from '../domain/politica-intentos';
import { EmitirSesion } from './emitir-sesion';
import { IntentosRepository } from './ports/intentos-repository';
import { PasswordHasher } from './ports/password-hasher';
import { SesionRepository } from './ports/sesion-repository';
import { UsuarioRepository } from './ports/usuario-repository';
import type { SesionIniciada } from './sesion-iniciada';
import { hashDeToken } from './tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';

/**
 * Inicio de sesión con correo y contraseña (RF04, HU05; FR-007 a FR-010, FR-013). Operación pública.
 *
 * Usa transacciones separadas a propósito: el fallo de contraseña debe quedar registrado aunque la
 * operación termine en error, y el hash (lento) se verifica fuera de cualquier transacción.
 */
@Injectable()
export class IniciarSesion {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly intentos: IntentosRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly sesiones: SesionRepository,
    private readonly hasher: PasswordHasher,
    private readonly emitirSesion: EmitirSesion,
    private readonly reloj: Clock,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(correoIngresado: string, contrasena: string): Promise<SesionIniciada> {
    // Misma normalización que Correo (FR-029), sin rechazar formatos: un correo mal escrito es solo un fallo más.
    const correo = correoIngresado.trim().toLowerCase();
    const hashCorreo = hashDeToken(correo);
    const ip = this.tenantContext.datosSolicitud().ip ?? IP_DESCONOCIDA;

    // 1. ¿Está bloqueado el par cuenta + IP? Si no, ¿existe la cuenta? (ADR-015: sin tenant todavía)
    const cuenta = await this.uow.ejecutarSinTenant(async () => {
      const ahora = this.reloj.ahora();
      const fallos = await this.intentos.fallosDesde(
        hashCorreo,
        ip,
        new Date(ahora.getTime() - HISTORIAL_MS),
      );
      const evaluacion = PoliticaIntentos.evaluar(fallos, ahora);
      if (evaluacion.bloqueado) throw new DemasiadosIntentos(evaluacion.reintentarEnSegundos);
      return this.usuarios.resolverCuenta(correo);
    });

    // 2. Verificar la contraseña con el mismo costo exista o no la cuenta (FR-009).
    const valida = cuenta?.hashContrasena
      ? await this.hasher.verificar(cuenta.hashContrasena, contrasena)
      : await this.hasher.verificarFicticio(contrasena);
    if (!cuenta || !valida) {
      await this.uow.ejecutarSinTenant(() =>
        this.intentos.registrarFallo(hashCorreo, ip, this.reloj.ahora()),
      );
      throw new CredencialesInvalidas();
    }
    await this.uow.ejecutarSinTenant(() => this.intentos.borrarFallos(hashCorreo, ip));

    // 3. Credenciales correctas pero sin acceso: usuario desactivado o barbería suspendida (FR-013).
    if (cuenta.estadoMembresia !== 'ACTIVA' || cuenta.estadoBarberia !== 'ACTIVA') {
      throw new AccesoSuspendido();
    }

    // 4. Sesión dentro del tenant del usuario, con RLS.
    return this.uow.ejecutar(TenantId.de(cuenta.tenantId), async () => {
      await this.sesiones.purgarTerminadasDe(cuenta.usuarioId, this.reloj.ahora());
      const usuario = await this.usuarios.perfil(cuenta.usuarioId);
      if (!usuario) throw new CredencialesInvalidas();
      const sesion = await this.emitirSesion.ejecutar(cuenta.usuarioId, cuenta.rol);
      return { sesion, usuario };
    });
  }
}
