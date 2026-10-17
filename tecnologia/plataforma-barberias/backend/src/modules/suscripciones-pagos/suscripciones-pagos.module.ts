import { Module } from '@nestjs/common';
import { SuscripcionesApi } from './suscripciones-api';
import { IniciarPruebaGratuita } from './suscripciones/application/iniciar-prueba-gratuita';
import { ObtenerLimiteBarberos } from './suscripciones/application/obtener-limite-barberos';
import { ObtenerLimiteUsuarios } from './suscripciones/application/obtener-limite-usuarios';
import { SuscripcionRepository } from './suscripciones/application/ports/suscripcion-repository';
import { KyselySuscripcionRepository } from './suscripciones/infrastructure/kysely-suscripcion-repository';

/** M03 Suscripciones y pagos. En esta funcionalidad solo la parte mínima de suscripciones (prueba gratuita). */
@Module({
  providers: [
    { provide: SuscripcionRepository, useClass: KyselySuscripcionRepository },
    IniciarPruebaGratuita,
    ObtenerLimiteUsuarios,
    ObtenerLimiteBarberos,
    SuscripcionesApi,
  ],
  exports: [SuscripcionesApi],
})
export class SuscripcionesPagosModule {}
