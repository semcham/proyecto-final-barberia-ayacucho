import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T040 de 005 · Errores del asistente (contracts/openapi.yaml de 005). Con el formato de siempre, { codigo, mensaje,
// detalles }: los datos van en detalles[0]. El filtro del host pone Retry-After con detalles[0].reintentarEnSegundos.

export type AlcanceDeCuota = 'USUARIO' | 'BARBERIA';
export type Alternativa = 'RESERVAR' | 'REPORTES';

/** 429: la cuota del usuario o de la barbería se agotó por hoy. */
export class CuotaAsistenteAgotada extends ErrorDeAplicacion {
  readonly codigo = 'CUOTA_ASISTENTE_AGOTADA';

  constructor(alcance: AlcanceDeCuota, reiniciaEn: string, reintentarEnSegundos: number) {
    super(
      alcance === 'USUARIO'
        ? 'Llegaste al límite de preguntas al asistente de hoy. Mientras tanto, puedes reservar directamente.'
        : 'La barbería llegó al límite de preguntas al asistente de hoy. Mientras tanto, puedes reservar directamente.',
      [{ alcance, reiniciaEn, reintentarEnSegundos }],
    );
  }
}

/** 503: el proveedor de IA no respondió a tiempo, falló o tiene el circuito abierto. */
export class AsistenteNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'ASISTENTE_NO_DISPONIBLE';

  constructor(alternativa: Alternativa) {
    super(
      alternativa === 'RESERVAR'
        ? 'El asistente no está disponible ahora. Puedes reservar directamente.'
        : 'El asistente no está disponible ahora. Puedes ver tus reportes directamente.',
      [{ alternativa: { tipo: alternativa } }],
    );
  }
}
