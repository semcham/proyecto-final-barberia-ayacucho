import { ErrorDeAplicacion } from '../../../../shared/nucleo';
import { QrRequerido } from './errores';
import type { TipoAdelanto } from './politica-adelanto';

// T017 de 008 · La configuración del adelanto de una barbería y sus reglas (FR-001, FR-002; data-model §1). Regla
// pura: recibe la configuración guardada y el cambio pedido, y devuelve la nueva o rechaza sin efecto.

/** Límites de FR-002 (los mismos CHECK de booking_deposit_settings). */
export const LIMITES_ADELANTO = {
  montoCentimos: { minimo: 100, maximo: 50_000 },
  porcentaje: { minimo: 1, maximo: 100 },
  plazoMinutos: { minimo: 10, maximo: 1440 },
} as const;

export interface ConfiguracionAdelanto {
  activo: boolean;
  tipo: TipoAdelanto | null;
  montoCentimos: number | null;
  porcentaje: number | null;
  plazoMinutos: number | null;
  qrArchivoId: string | null;
  actualizadoEn: Date | null;
}

/** Lo que el propietario pide cambiar. Lo que no envía se conserva (desactivar no borra los valores). */
export interface CambioDeConfiguracion {
  activo: boolean;
  tipo?: TipoAdelanto;
  montoCentimos?: number;
  porcentaje?: number;
  plazoMinutos?: number;
}

/** Los valores que se guardan (el QR y la fecha los maneja el caso de uso). */
export type ValoresDeConfiguracion = Pick<
  ConfiguracionAdelanto,
  'activo' | 'tipo' | 'montoCentimos' | 'porcentaje' | 'plazoMinutos'
>;

type Campo = 'tipo' | 'montoCentimos' | 'porcentaje' | 'plazoMinutos';

/**
 * Configuración fuera de rango o incompleta (FR-002). Código VALIDACION, como el resto de los datos inválidos,
 * pero con 422 (contracts/openapi.yaml de 008): el cuerpo está bien formado y lo que falla es la regla. El
 * detalle dice qué dato corregir (US1-2), sin repetir lo recibido.
 */
export class ConfiguracionAdelantoInvalida extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  readonly estadoHttp = 422;

  constructor(problemas: { campo: Campo; problema: 'requerido' | 'fuera_de_rango' | 'no_corresponde' }[]) {
    super('Revisa los datos del adelanto.', problemas);
  }
}

const SIN_CONFIGURAR: ConfiguracionAdelanto = {
  activo: false,
  tipo: null,
  montoCentimos: null,
  porcentaje: null,
  plazoMinutos: null,
  qrArchivoId: null,
  actualizadoEn: null,
};

export const ConfiguracionDeAdelanto = {
  /** La configuración de una barbería que nunca la guardó: inactiva, sin valores ni QR. */
  sinConfigurar(): ConfiguracionAdelanto {
    return { ...SIN_CONFIGURAR };
  },

  /**
   * Aplica el cambio a la configuración guardada (o a ninguna). Cambiar de tipo deja solo el valor del tipo nuevo.
   * Lanza ConfiguracionAdelantoInvalida si un valor está fuera de rango, no corresponde al tipo o falta para
   * activar; y QrRequerido si se activa sin QR (FR-002).
   */
  aplicar(guardada: ConfiguracionAdelanto | null, cambio: CambioDeConfiguracion): ValoresDeConfiguracion {
    const actual = guardada ?? SIN_CONFIGURAR;
    const problemas: ConstructorParameters<typeof ConfiguracionAdelantoInvalida>[0] = [];
    const fuera = (campo: Campo, valor: number | undefined) => {
      const { minimo, maximo } = LIMITES_ADELANTO[campo as keyof typeof LIMITES_ADELANTO];
      if (valor !== undefined && (valor < minimo || valor > maximo)) {
        problemas.push({ campo, problema: 'fuera_de_rango' });
      }
    };
    fuera('montoCentimos', cambio.montoCentimos);
    fuera('porcentaje', cambio.porcentaje);
    fuera('plazoMinutos', cambio.plazoMinutos);

    const tipo = cambio.tipo ?? actual.tipo;
    const mismoTipo = tipo === actual.tipo;
    let montoCentimos = cambio.montoCentimos ?? (mismoTipo ? actual.montoCentimos : null);
    let porcentaje = cambio.porcentaje ?? (mismoTipo ? actual.porcentaje : null);
    if (tipo === null && (cambio.montoCentimos !== undefined || cambio.porcentaje !== undefined)) {
      problemas.push({ campo: 'tipo', problema: 'requerido' });
    }
    if (tipo === 'FIJO') {
      if (cambio.porcentaje !== undefined)
        problemas.push({ campo: 'porcentaje', problema: 'no_corresponde' });
      porcentaje = null;
    }
    if (tipo === 'PORCENTAJE') {
      if (cambio.montoCentimos !== undefined) {
        problemas.push({ campo: 'montoCentimos', problema: 'no_corresponde' });
      }
      montoCentimos = null;
    }
    const plazoMinutos = cambio.plazoMinutos ?? actual.plazoMinutos;

    if (cambio.activo) {
      if (tipo === null) problemas.push({ campo: 'tipo', problema: 'requerido' });
      if (tipo === 'FIJO' && montoCentimos === null) {
        problemas.push({ campo: 'montoCentimos', problema: 'requerido' });
      }
      if (tipo === 'PORCENTAJE' && porcentaje === null) {
        problemas.push({ campo: 'porcentaje', problema: 'requerido' });
      }
      if (plazoMinutos === null) problemas.push({ campo: 'plazoMinutos', problema: 'requerido' });
    }
    if (problemas.length > 0) {
      // Un mismo campo una sola vez (p. ej. "tipo requerido" por dos motivos).
      const unicos = problemas.filter(
        (p, i) => problemas.findIndex((q) => q.campo === p.campo && q.problema === p.problema) === i,
      );
      throw new ConfiguracionAdelantoInvalida(unicos);
    }
    if (cambio.activo && actual.qrArchivoId === null) throw new QrRequerido();

    return {
      activo: cambio.activo,
      tipo: tipo === null ? null : tipo,
      montoCentimos: tipo === null ? null : montoCentimos,
      porcentaje: tipo === null ? null : porcentaje,
      plazoMinutos,
    };
  },
};
