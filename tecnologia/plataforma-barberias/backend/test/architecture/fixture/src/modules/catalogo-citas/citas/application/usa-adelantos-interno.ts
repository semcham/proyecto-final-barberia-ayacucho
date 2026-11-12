// Violación a propósito (T006 de 008, adelantos-solo-por-api): M02 usa una clase interna del submódulo de
// adelantos de M03 en lugar de AdelantosApi.
import { ESTADOS_ADELANTO } from '../../../suscripciones-pagos/adelantos/domain/adelanto';

export const usaAdelantosInterno = ESTADOS_ADELANTO;
