import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditLog, Configuracion, TenantContext, TenantId, UnitOfWork } from '../../../../shared';
import { type ResumenSuscripcion, SuscripcionesApi } from '../../../suscripciones-pagos';
import { EmitirSesion, type SesionEmitida } from '../../identidad/application/emitir-sesion';
import { PasswordHasher } from '../../identidad/application/ports/password-hasher';
import { UsuarioRepository } from '../../identidad/application/ports/usuario-repository';
import { Contrasena } from '../../identidad/domain/contrasena';
import { Correo } from '../../identidad/domain/correo';
import { Membresia } from '../../identidad/domain/membresia';
import { NombrePersona } from '../../identidad/domain/nombre-persona';
import { AceptacionTerminos } from '../domain/aceptacion-terminos';
import { Barberia } from '../domain/barberia';
import { NombreBarberia } from '../domain/nombre-barberia';
import { Slug } from '../domain/slug';
import { TenantRepository } from './ports/tenant-repository';
import { TermsAcceptanceRepository } from './ports/terms-acceptance-repository';

export interface ComandoRegistrarBarberia {
  nombreBarberia: string;
  propietario: { nombre: string; correo: string; contrasena: string };
  aceptaciones: { terminosVersion: string; politicaDatosVersion: string };
}

export interface BarberiaRegistrada {
  barberia: { id: string; nombre: string; slug: string };
  propietario: { id: string; nombre: string; correo: string };
  suscripcion: ResumenSuscripcion;
  sesion: SesionEmitida;
}

/**
 * Registro de una barbería (RF01, RF18, HU02). En UNA transacción crea la barbería, la cuenta y la
 * membresía del propietario, las aceptaciones de los textos legales y la prueba gratuita (M03), deja la
 * auditoría y abre la sesión del propietario. Si algo falla, no queda nada (FR-002, R12).
 * Es una operación pública: no exige permiso de rol.
 */
@Injectable()
export class RegistrarBarberia {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tenants: TenantRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly aceptaciones: TermsAcceptanceRepository,
    private readonly suscripciones: SuscripcionesApi,
    private readonly emitirSesion: EmitirSesion,
    private readonly hasher: PasswordHasher,
    private readonly auditoria: AuditLog,
    private readonly configuracion: Configuracion,
    private readonly tenantContext: TenantContext,
  ) {}

  async ejecutar(comando: ComandoRegistrarBarberia): Promise<BarberiaRegistrada> {
    // Validaciones de dominio antes de abrir la transacción.
    const nombreBarberia = NombreBarberia.crear(comando.nombreBarberia);
    const correo = Correo.crear(comando.propietario.correo);
    const nombrePropietario = NombrePersona.crear(comando.propietario.nombre, 'propietario.nombre');
    const contrasena = Contrasena.crear(comando.propietario.contrasena, correo);
    const terminos = AceptacionTerminos.aceptar(
      'TERMINOS',
      comando.aceptaciones.terminosVersion,
      this.configuracion.versionTerminos,
    );
    const politicaDatos = AceptacionTerminos.aceptar(
      'POLITICA_DATOS',
      comando.aceptaciones.politicaDatosVersion,
      this.configuracion.versionPoliticaDatos,
    );
    // El hash es lento a propósito: se calcula fuera de la transacción para no retener la conexión.
    const hashContrasena = await this.hasher.hash(contrasena);

    return this.uow.ejecutarSinTenant(async () => {
      const barberia = Barberia.registrar(uuidv7(), nombreBarberia, Slug.desdeNombre(nombreBarberia.valor));
      await this.tenants.insertar(barberia);
      const tenantId = TenantId.de(barberia.id);
      // Desde aquí RLS se aplica con el tenant recién creado.
      await this.uow.fijarTenant(tenantId);

      const usuarioId = uuidv7();
      await this.usuarios.crearCuenta({ id: usuarioId, correo, nombre: nombrePropietario, hashContrasena });
      await this.usuarios.crearMembresia(Membresia.crearPropietario(uuidv7(), barberia.id, usuarioId));

      const solicitud = this.tenantContext.datosSolicitud();
      await this.aceptaciones.registrar(usuarioId, terminos, solicitud);
      await this.aceptaciones.registrar(usuarioId, politicaDatos, solicitud);

      const suscripcion = await this.suscripciones.iniciarPruebaGratuita(tenantId);

      await this.auditoria.registrar({
        accion: 'BARBERIA_REGISTRADA',
        actorId: usuarioId,
        recurso: `barberia:${barberia.id}`,
        resultado: 'PERMITIDO',
      });

      const sesion = await this.emitirSesion.ejecutar(usuarioId, 'PROPIETARIO');

      return {
        barberia: { id: barberia.id, nombre: barberia.nombre.valor, slug: barberia.slug.valor },
        propietario: { id: usuarioId, nombre: nombrePropietario.valor, correo: correo.valor },
        suscripcion,
        sesion,
      };
    });
  }
}
