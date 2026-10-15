import { ValorInvalido } from '../../identidad/domain/errores';

export type DocumentoLegal = 'TERMINOS' | 'POLITICA_DATOS';

const CAMPO: Record<DocumentoLegal, string> = {
  TERMINOS: 'aceptaciones.terminosVersion',
  POLITICA_DATOS: 'aceptaciones.politicaDatosVersion',
};

/** Evidencia de que el propietario aceptó la versión vigente de un texto legal (FR-005, Ley N.° 29733). */
export class AceptacionTerminos {
  private constructor(
    readonly documento: DocumentoLegal,
    readonly version: string,
  ) {}

  /** Solo se acepta la versión vigente: la que mostró la pantalla debe coincidir con la del servidor. */
  static aceptar(
    documento: DocumentoLegal,
    versionAceptada: string,
    versionVigente: string,
  ): AceptacionTerminos {
    if (!versionVigente || versionAceptada !== versionVigente) {
      throw new ValorInvalido(CAMPO[documento], 'version_no_vigente');
    }
    return new AceptacionTerminos(documento, versionAceptada);
  }
}
