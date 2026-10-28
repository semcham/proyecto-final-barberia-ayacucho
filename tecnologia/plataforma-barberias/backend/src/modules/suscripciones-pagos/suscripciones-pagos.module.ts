import { Module } from '@nestjs/common';
import { Clock, Configuracion } from '../../shared';
import { PaymentGateway } from './pagos/application/ports/payment-gateway';
import { crearPasarela } from './pagos/infrastructure/fabrica-pasarela';
import { SuscripcionesApi } from './suscripciones-api';
import { ExigirOperacion } from './suscripciones/application/exigir-operacion';
import { IniciarPruebaGratuita } from './suscripciones/application/iniciar-prueba-gratuita';
import { ObtenerLimiteBarberos } from './suscripciones/application/obtener-limite-barberos';
import { ObtenerLimiteUsuarios } from './suscripciones/application/obtener-limite-usuarios';
import { SuscripcionRepository } from './suscripciones/application/ports/suscripcion-repository';
import { KyselySuscripcionRepository } from './suscripciones/infrastructure/kysely-suscripcion-repository';

/**
 * M03 Suscripciones y pagos. Prueba gratuita y límites (001 y 002); en 003, planes, períodos, pagos con la
 * pasarela detrás de PaymentGateway (elegida por PAGOS_PROVEEDOR, ADR-022) y restricciones por estado.
 */
@Module({
  providers: [
    { provide: SuscripcionRepository, useClass: KyselySuscripcionRepository },
    { provide: PaymentGateway, inject: [Configuracion, Clock], useFactory: crearPasarela },
    IniciarPruebaGratuita,
    ExigirOperacion,
    ObtenerLimiteUsuarios,
    ObtenerLimiteBarberos,
    SuscripcionesApi,
  ],
  exports: [SuscripcionesApi],
})
export class SuscripcionesPagosModule {}
