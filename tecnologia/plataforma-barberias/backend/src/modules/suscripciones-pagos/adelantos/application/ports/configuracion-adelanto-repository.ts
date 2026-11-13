import type { ConfiguracionAdelanto, ValoresDeConfiguracion } from '../../domain/configuracion-adelanto';

/**
 * T016 de 008 · Configuración del adelanto de la barbería de la transacción en curso (booking_deposit_settings,
 * una fila por barbería, con RLS). Todas las operaciones corren dentro de UnitOfWork.ejecutar.
 */
export abstract class ConfiguracionAdelantoRepository {
  /** La configuración guardada, o null si la barbería nunca la guardó. Con `bloquear`, FOR UPDATE. */
  abstract actual(opciones?: { bloquear?: boolean }): Promise<ConfiguracionAdelanto | null>;

  /**
   * Guarda los valores (crea la fila si no existe) y conserva el QR. `qrArchivoId` es el QR vigente que leyó el
   * caso de uso con la fila bloqueada: solo se usa si la fila todavía no existe.
   */
  abstract guardar(
    valores: ValoresDeConfiguracion,
    qrArchivoId: string | null,
    por: string,
    en: Date,
  ): Promise<ConfiguracionAdelanto>;

  /** Cambia el QR vigente (crea la fila inactiva si no existe) y conserva el resto. */
  abstract fijarQr(archivoId: string, por: string, en: Date): Promise<ConfiguracionAdelanto>;
}
