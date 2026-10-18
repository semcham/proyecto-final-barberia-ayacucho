import { Injectable } from '@nestjs/common';
import { Clock, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { BarberiasApi } from '../../api-publica';
import { type DatosUnion, UnirseABarberia } from '../../clientes/application/unirse-a-barberia';
import {
  AccesoSuspendido,
  CredencialesInvalidas,
  CuentaDePersonal,
  DemasiadosIntentos,
  IngresaDesdeTuBarberia,
  UnirseRequiereConsentimiento,
} from '../domain/errores';
import { HISTORIAL_MS, PoliticaIntentos } from '../domain/politica-intentos';
import { EmitirSesion } from './emitir-sesion';
import { IntentosRepository } from './ports/intentos-repository';
import { PasswordHasher } from './ports/password-hasher';
import { SesionRepository } from './ports/sesion-repository';
import { UsuarioRepository } from './ports/usuario-repository';
import type { SesionIniciada } from './sesion-iniciada';
import { hashDeToken } from './tokens-opacos';

const IP_DESCONOCIDA = '0.0.0.0';

/** Ingreso desde el enlace de una barbería (funcionalidad 002, ADR-020). */
export interface OpcionesIngreso {
  /** `slug` de la página desde la que ingresa: elige la barbería de la sesión. */
  barberia?: string;
  /** Aceptación y teléfono para unirse a esa barbería si aún no es cliente de ella. */
  union?: DatosUnion;
}

/**
 * Inicio de sesión con correo y contraseña (RF04, HU05; FR-007 a FR-010, FR-013). Operación pública.
 *
 * Usa transacciones separadas a propósito: el fallo de contraseña debe quedar registrado aunque la
 * operación termine en error, y el hash (lento) se verifica fuera de cualquier transacción.
 *
 * Funcionalidad 002 (T087, ADR-020): sin enlace, entra el personal como en 001 y una cuenta de cliente
 * recibe INGRESA_DESDE_TU_BARBERIA. Con enlace, la barbería se elige por su `slug` (constitución 1.2.0,
 * selección de membresía por enlace) y la membresía se busca con RLS en esa barbería; si no la tiene, el
 * cliente debe aceptar la política para unirse. Todo, después de verificar la contraseña.
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
    private readonly barberias: BarberiasApi,
    private readonly unirse: UnirseABarberia,
  ) {}

  async ejecutar(
    correoIngresado: string,
    contrasena: string,
    opciones: OpcionesIngreso = {},
  ): Promise<SesionIniciada> {
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
    const personal = cuenta.personal;

    // Ingreso desde el enlace de una barbería (002): sesión en esa barbería.
    if (opciones.barberia !== undefined) {
      return this.ingresarEnBarberia(cuenta.usuarioId, personal !== null, opciones.barberia, opciones.union);
    }
    // Sin enlace, una cuenta de cliente debe entrar desde la página de su barbería (solo tras verificar
    // la contraseña: con una contraseña errada recibe el mismo 401 de siempre).
    if (!personal) throw new IngresaDesdeTuBarberia();

    // 3. Credenciales correctas pero sin acceso: usuario desactivado o barbería suspendida (FR-013).
    if (personal.estadoMembresia !== 'ACTIVA' || personal.estadoBarberia !== 'ACTIVA') {
      throw new AccesoSuspendido();
    }

    // 4. Sesión dentro del tenant del usuario, con RLS.
    return this.uow.ejecutar(TenantId.de(personal.tenantId), async () => {
      await this.sesiones.purgarTerminadasDe(cuenta.usuarioId, this.reloj.ahora());
      const usuario = await this.usuarios.perfil(cuenta.usuarioId);
      if (!usuario) throw new CredencialesInvalidas();
      const sesion = await this.emitirSesion.ejecutar(cuenta.usuarioId, personal.rol);
      return { sesion, usuario };
    });
  }

  /**
   * Sesión en la barbería del enlace (ADR-020). El tenant se resuelve por el `slug` y la membresía se busca
   * con RLS en esa barbería; si no la tiene, se une solo con la aceptación de la política. El personal no se
   * une como cliente.
   */
  private async ingresarEnBarberia(
    usuarioId: string,
    esPersonal: boolean,
    slug: string,
    union: DatosUnion | undefined,
  ): Promise<SesionIniciada> {
    const tenantId = await this.barberias.resolverSlugPublico(slug);
    return this.uow.ejecutar(tenantId, async () => {
      let membresia = await this.usuarios.membresiaEnContexto(usuarioId);
      if (!membresia) {
        if (esPersonal) throw new CuentaDePersonal();
        if (union?.aceptaPoliticaDatos !== true) throw new UnirseRequiereConsentimiento();
        await this.unirse.ejecutar(usuarioId, this.unirse.validar(false, union));
        membresia = await this.usuarios.membresiaEnContexto(usuarioId);
        if (!membresia) throw new Error('La membresía recién creada no es visible');
      }
      if (!membresia.estaActiva()) throw new AccesoSuspendido();
      await this.sesiones.purgarTerminadasDe(usuarioId, this.reloj.ahora());
      const usuario = await this.usuarios.perfil(usuarioId);
      if (!usuario) throw new CredencialesInvalidas();
      const sesion = await this.emitirSesion.ejecutar(usuarioId, membresia.rol.codigo);
      return { sesion, usuario };
    });
  }
}
