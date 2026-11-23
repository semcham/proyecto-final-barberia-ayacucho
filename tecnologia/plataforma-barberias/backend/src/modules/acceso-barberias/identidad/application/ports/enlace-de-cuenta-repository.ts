import type { EnlaceDeCuenta, PropositoEnlace } from '../../domain/enlace-de-cuenta';
import type { IntentosRecientes, TipoIntentoEnlace } from '../../domain/limite-enlaces';

// T040 de 010 · Puertos de los enlaces de cuenta (data-model §2 a §4; research R01 a R04 y R08).

/** Enlaces de la barbería del contexto (tabla `account_link`, RLS por tenant), en la transacción en curso. */
export abstract class EnlaceDeCuentaRepository {
  /** Alta de un enlace nuevo, sin token (R02). */
  abstract crear(enlace: EnlaceDeCuenta): Promise<void>;
  /** Anula los enlaces sin usar ni anular de la cuenta con ese propósito, en esta barbería. Devuelve cuántos. */
  abstract anularVigentesDe(usuarioId: string, proposito: PropositoEnlace, ahora: Date): Promise<number>;
  /**
   * Guarda el hash de un token nuevo SOLO si el enlace sigue vigente (sin usar, sin anular, sin vencer); el
   * vencimiento no se mueve. Devuelve el propósito y el vencimiento, o null si el enlace ya no sirve.
   */
  abstract guardarHashSiVigente(
    enlaceId: string,
    hashToken: string,
    ahora: Date,
  ): Promise<{ proposito: PropositoEnlace; venceEn: Date } | null>;
  /** Retención: borra hasta `lote` enlaces usados, anulados o vencidos antes de `limite`. */
  abstract purgarTerminados(limite: Date, lote: number): Promise<number>;
}

/** Resultado de consumir un enlace con su función de sistema; null si ningún enlace de ese propósito tiene el hash. */
export type ResultadoDeConsumo = {
  resultado: 'APLICADO' | 'RECHAZADO';
  tenantId: string;
  usuarioId: string;
} | null;

/**
 * Funciones de sistema de barberias_auth (ADR-015 revisado por ADR-036; constitución 1.8.0, principio III): lo que
 * ocurre antes de conocer la barbería o sobre todas las de la cuenta. Se llaman en la transacción en curso.
 */
export abstract class FuncionesDeCuenta {
  /** Barbería del aviso de una cuenta (R03), o null si no tiene ninguna membresía activa. */
  abstract barberiaParaEnlace(usuarioId: string, preferida: string | null): Promise<string | null>;
  abstract verificarCorreo(hashToken: string): Promise<ResultadoDeConsumo>;
  abstract restablecerContrasena(hashToken: string, hashContrasenaNueva: string): Promise<ResultadoDeConsumo>;
  /** La usa la activación del personal, en su transacción, después de marcar la activación como usada. */
  abstract marcarVerificadaPorActivacion(usuarioId: string): Promise<void>;
}

/** El correo y el estado de verificación de una cuenta visible en la barbería del contexto (RLS por membresía). */
export abstract class EstadoDeCuentas {
  abstract correoYVerificacion(usuarioId: string): Promise<{ correo: string; verificado: boolean } | null>;
}

/**
 * Contador de solicitudes y usos fallidos (`account_link_attempt`, tabla técnica sin barbería): se usa dentro de
 * `UnitOfWork.ejecutarSinTenant`. Recibe la IP; el adaptador guarda solo su HMAC con INTENTOS_SAL_IP.
 */
export abstract class IntentosEnlaceDeCuentaRepository {
  /** Intentos de `tipo` desde `desde`: los de la cuenta (`sujetoHash`; ninguno si es null) y los del origen. */
  abstract recientes(
    tipo: TipoIntentoEnlace,
    sujetoHash: string | null,
    ip: string,
    desde: Date,
  ): Promise<IntentosRecientes>;
  /** Registra un intento y, en la misma sentencia, purga los de más de 24 h (purga oportunista). */
  abstract registrar(
    tipo: TipoIntentoEnlace,
    sujetoHash: string | null,
    ip: string,
    ahora: Date,
  ): Promise<void>;
}

/** Barberías a recorrer en la retención de los enlaces (con el rol de lectura de la plataforma, solo `tenant.id`). */
export abstract class BarberiasParaRetencion {
  abstract listar(maximo: number): Promise<string[]>;
}
