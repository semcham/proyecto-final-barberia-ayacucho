import { ValorInvalido } from '../../identidad/domain/errores';

export type MetodoConsentimiento = 'EN_LINEA' | 'PRESENCIAL';

/**
 * T083 · Evidencia del consentimiento del cliente con la política de tratamiento de datos de UNA
 * barbería (FR-024, EQ-18; Ley N.° 29733). La versión aceptada debe ser la vigente. El presencial lo anota
 * el propietario (FR-035) y debe constar quién lo anotó.
 */
export class Consentimiento {
  private constructor(
    readonly version: string,
    readonly metodo: MetodoConsentimiento,
    readonly registradoPor: string | null,
  ) {}

  static enLinea(aceptado: unknown, version: string, versionVigente: string): Consentimiento {
    if (aceptado !== true) throw new ValorInvalido('aceptaPoliticaDatos', 'requerido');
    Consentimiento.exigirVigente(version, versionVigente);
    return new Consentimiento(version, 'EN_LINEA', null);
  }

  static presencial(
    aceptadoVerbalmente: unknown,
    version: string,
    versionVigente: string,
    registradoPor: string,
  ): Consentimiento {
    if (aceptadoVerbalmente !== true) throw new ValorInvalido('consentimientoVerbal', 'requerido');
    if (!registradoPor) throw new ValorInvalido('registradoPor', 'requerido');
    Consentimiento.exigirVigente(version, versionVigente);
    return new Consentimiento(version, 'PRESENCIAL', registradoPor);
  }

  private static exigirVigente(version: string, versionVigente: string): void {
    if (!versionVigente || version !== versionVigente) {
      throw new ValorInvalido('versionPoliticaDatos', 'no_vigente');
    }
  }
}
