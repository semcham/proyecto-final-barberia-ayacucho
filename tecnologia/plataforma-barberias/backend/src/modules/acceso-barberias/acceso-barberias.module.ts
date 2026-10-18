import { Module } from '@nestjs/common';
import { SuscripcionesPagosModule } from '../suscripciones-pagos';
import { BarberiasApi, ClientesApi, PersonalApi } from './api-publica';
import { ActualizarBarberia } from './barberias/application/actualizar-barberia';
import { BarberiasApiImpl } from './barberias/application/barberias-api';
import { ObtenerBarberia } from './barberias/application/obtener-barberia';
import { BarberiaController } from './barberias/presentation/barberia.controller';
import { PersonalApiImpl } from './identidad/application/personal-api';
import { ClientesApiImpl } from './clientes/application/clientes-api';
import { ConsentimientoRepository } from './clientes/application/ports/consentimiento-repository';
import { PerfilClienteRepository } from './clientes/application/ports/perfil-cliente-repository';
import { RegistrarCliente } from './clientes/application/registrar-cliente';
import { UnirseABarberia } from './clientes/application/unirse-a-barberia';
import { KyselyConsentimientoRepository } from './clientes/infrastructure/kysely-consentimiento-repository';
import { KyselyPerfilClienteRepository } from './clientes/infrastructure/kysely-perfil-cliente-repository';
import { ClientesController } from './clientes/presentation/clientes.controller';
import { CambiarBarberia } from './identidad/application/cambiar-barberia';
import { TenantRepository } from './barberias/application/ports/tenant-repository';
import { TermsAcceptanceRepository } from './barberias/application/ports/terms-acceptance-repository';
import { RegistrarBarberia } from './barberias/application/registrar-barberia';
import { KyselyTenantRepository } from './barberias/infrastructure/kysely-tenant-repository';
import { KyselyTermsAcceptanceRepository } from './barberias/infrastructure/kysely-terms-acceptance-repository';
import { BarberiasController } from './barberias/presentation/barberias.controller';
import { ActivarCuenta } from './identidad/application/activar-cuenta';
import { ActualizarUsuario } from './identidad/application/actualizar-usuario';
import { Autorizacion } from './identidad/application/autorizacion';
import { CerrarSesion } from './identidad/application/cerrar-sesion';
import { CrearUsuario } from './identidad/application/crear-usuario';
import { EmitirSesion } from './identidad/application/emitir-sesion';
import { GenerarEnlaceActivacion } from './identidad/application/enlace-activacion';
import { IniciarSesion } from './identidad/application/iniciar-sesion';
import { ListarUsuarios } from './identidad/application/listar-usuarios';
import { ObtenerUsuario } from './identidad/application/obtener-usuario';
import { ObtenerUsuarioActual } from './identidad/application/obtener-usuario-actual';
import { ActivacionRepository } from './identidad/application/ports/activacion-repository';
import { IntentosRepository } from './identidad/application/ports/intentos-repository';
import { PasswordHasher } from './identidad/application/ports/password-hasher';
import { SesionRepository } from './identidad/application/ports/sesion-repository';
import { TokenSigner } from './identidad/application/ports/token-signer';
import { UsuarioRepository } from './identidad/application/ports/usuario-repository';
import { RegenerarActivacion } from './identidad/application/regenerar-activacion';
import { RenovarSesion } from './identidad/application/renovar-sesion';
import { ValidarSolicitud } from './identidad/application/validar-solicitud';
import { Argon2PasswordHasher } from './identidad/infrastructure/argon2-password-hasher';
import { JoseTokenSigner } from './identidad/infrastructure/jose-token-signer';
import { KyselyActivacionRepository } from './identidad/infrastructure/kysely-activacion-repository';
import { KyselyIntentosRepository } from './identidad/infrastructure/kysely-intentos-repository';
import { KyselySesionRepository } from './identidad/infrastructure/kysely-sesion-repository';
import { KyselyUsuarioRepository } from './identidad/infrastructure/kysely-usuario-repository';
import { AuthController } from './identidad/presentation/auth.controller';
import { UsuariosController } from './identidad/presentation/usuarios.controller';

/** M01 Acceso y barberías (submódulos identidad y barberias). */
@Module({
  // M01 → M03 está permitido por la matriz de dependencias; solo se usa su interfaz pública.
  imports: [SuscripcionesPagosModule],
  controllers: [
    BarberiasController,
    BarberiaController,
    AuthController,
    UsuariosController,
    ClientesController,
  ],
  providers: [
    // Puertos → adaptadores
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: TokenSigner, useClass: JoseTokenSigner },
    { provide: SesionRepository, useClass: KyselySesionRepository },
    { provide: UsuarioRepository, useClass: KyselyUsuarioRepository },
    { provide: ActivacionRepository, useClass: KyselyActivacionRepository },
    { provide: IntentosRepository, useClass: KyselyIntentosRepository },
    { provide: TenantRepository, useClass: KyselyTenantRepository },
    { provide: TermsAcceptanceRepository, useClass: KyselyTermsAcceptanceRepository },
    // Servicios y casos de uso
    Autorizacion,
    EmitirSesion,
    GenerarEnlaceActivacion,
    ValidarSolicitud,
    RegistrarBarberia,
    IniciarSesion,
    RenovarSesion,
    CerrarSesion,
    ObtenerUsuarioActual,
    CrearUsuario,
    ListarUsuarios,
    ObtenerUsuario,
    ActualizarUsuario,
    RegenerarActivacion,
    ActivarCuenta,
    { provide: PerfilClienteRepository, useClass: KyselyPerfilClienteRepository },
    { provide: ConsentimientoRepository, useClass: KyselyConsentimientoRepository },
    // Cuenta de cliente (funcionalidad 002, ADR-020).
    UnirseABarberia,
    RegistrarCliente,
    CambiarBarberia,
    // Configuración de la barbería (US1 de 002).
    ObtenerBarberia,
    ActualizarBarberia,
    // Interfaces públicas para M02 (ADR-020).
    { provide: BarberiasApi, useClass: BarberiasApiImpl },
    { provide: ClientesApi, useClass: ClientesApiImpl },
    { provide: PersonalApi, useClass: PersonalApiImpl },
  ],
  exports: [ValidarSolicitud, BarberiasApi, ClientesApi, PersonalApi],
})
export class AccesoBarberiasModule {}
