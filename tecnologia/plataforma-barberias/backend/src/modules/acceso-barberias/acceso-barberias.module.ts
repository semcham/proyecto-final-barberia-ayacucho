import { Module } from '@nestjs/common';
import { Autorizacion } from './identidad/application/autorizacion';
import { EmitirSesion } from './identidad/application/emitir-sesion';
import { PasswordHasher } from './identidad/application/ports/password-hasher';
import { SesionRepository } from './identidad/application/ports/sesion-repository';
import { TokenSigner } from './identidad/application/ports/token-signer';
import { ValidarSolicitud } from './identidad/application/validar-solicitud';
import { Argon2PasswordHasher } from './identidad/infrastructure/argon2-password-hasher';
import { JoseTokenSigner } from './identidad/infrastructure/jose-token-signer';
import { KyselySesionRepository } from './identidad/infrastructure/kysely-sesion-repository';

/** M01 Acceso y barberías (submódulos identidad y barberias). Las historias agregan aquí sus piezas. */
@Module({
  providers: [
    { provide: PasswordHasher, useClass: Argon2PasswordHasher },
    { provide: TokenSigner, useClass: JoseTokenSigner },
    { provide: SesionRepository, useClass: KyselySesionRepository },
    EmitirSesion,
    ValidarSolicitud,
    Autorizacion,
  ],
  exports: [ValidarSolicitud],
})
export class AccesoBarberiasModule {}
