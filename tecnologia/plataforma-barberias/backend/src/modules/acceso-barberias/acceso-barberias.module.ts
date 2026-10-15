import { Module } from '@nestjs/common';
import { SuscripcionesPagosModule } from '../suscripciones-pagos';
import { TenantRepository } from './barberias/application/ports/tenant-repository';
import { TermsAcceptanceRepository } from './barberias/application/ports/terms-acceptance-repository';
import { RegistrarBarberia } from './barberias/application/registrar-barberia';
import { KyselyTenantRepository } from './barberias/infrastructure/kysely-tenant-repository';
import { KyselyTermsAcceptanceRepository } from './barberias/infrastructure/kysely-terms-acceptance-repository';
import { BarberiasController } from './barberias/presentation/barberias.controller';
import { Autorizacion } from './identidad/application/autorizacion';
import { CerrarSesion } from './identidad/application/cerrar-sesion';
import { EmitirSesion } from './identidad/application/emitir-sesion';
import { IniciarSesion } from './identidad/application/iniciar-sesion';
import { ObtenerUsuarioActual } from './identidad/application/obtener-usuario-actual';
import { IntentosRepository } from './identidad/application/ports/intentos-repository';
import { PasswordHasher } from './identidad/application/ports/password-hasher';
import { RenovarSesion } from './identidad/application/renovar-sesion';
import { KyselyIntentosRepository } from './identidad/infrastructure/kysely-intentos-repository';
import { AuthController } from './identidad/presentation/auth.controller';
import { SesionRepository } from './identidad/application/ports/sesion-repository';
import { TokenSigner } from './identidad/application/ports/token-signer';
import { UsuarioRepository } from './identidad/application/ports/usuario-repository';
import { ValidarSolicitud } from './identidad/application/validar-solicitud';
import { Argon2PasswordHasher } from './identidad/infrastructure/argon2-password-hasher';
import { JoseTokenSigner } from './identidad/infrastructure/jose-token-signer';
import { KyselySesionRepository } from './identidad/infrastructure/kysely-sesion-repository';
import { KyselyUsuarioRepository } from './identidad/infrastructure/kysely-usuario-repository';

/** M01 Acceso y barberías (submódulos identidad y barberias). Las historias agregan aquí sus piezas. */
@Module({
  // M01 → M03 está permitido por la matriz de dependencias; solo se usa su interfaz pública.
  imports: [SuscripcionesPagosModule],
  controllers: [BarberiasController, AuthController],
  providers: [
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: TokenSigner, useClass: JoseTokenSigner },
    { provide: SesionRepository, useClass: KyselySesionRepository },
    { provide: UsuarioRepository, useClass: KyselyUsuarioRepository },
    { provide: TenantRepository, useClass: KyselyTenantRepository },
    { provide: TermsAcceptanceRepository, useClass: KyselyTermsAcceptanceRepository },
    { provide: IntentosRepository, useClass: KyselyIntentosRepository },
    EmitirSesion,
    ValidarSolicitud,
    Autorizacion,
    RegistrarBarberia,
    IniciarSesion,
    RenovarSesion,
    CerrarSesion,
    ObtenerUsuarioActual,
  ],
  exports: [ValidarSolicitud],
})
export class AccesoBarberiasModule {}
