// T011 de 005 · Puerto del proveedor de IA (principio VI, ADR-027 y ADR-028). El modelo solo CLASIFICA: recibe la
// pregunta y devuelve una intención y sus argumentos. No recibe el catálogo, ni datos de clientes, ni el tenant, y su
// texto nunca llega al usuario: el backend valida la intención, ejecuta la herramienta del rol y redacta con
// plantillas. Los adaptadores (falso, OpenRouter y ninguno) están en infrastructure/; solo el módulo los enlaza
// (regla ia-solo-por-puerto de PR14).

export type RolDelAsistente = 'CLIENTE' | 'PROPIETARIO';

/** Una intervención previa de la conversación abierta (el servidor no guarda historial, FR-012). */
export interface IntervencionPrevia {
  de: 'USUARIO' | 'ASISTENTE';
  texto: string;
}

/** Lo único que se envía al proveedor (FR-011, ADR-027 §3). */
export interface SolicitudDeInterpretacion {
  rol: RolDelAsistente;
  /** Intenciones del esquema que el rol puede usar, más las genéricas. */
  intencionesPermitidas: readonly string[];
  /** Fecha local de hoy en la barbería, `YYYY-MM-DD`, para las fechas relativas. */
  hoy: string;
  zonaHoraria: string;
  pregunta: string;
  contexto: readonly IntervencionPrevia[];
}

/**
 * Lo que devuelve el proveedor: solo la intención y sus argumentos, sin validar todavía contra el esquema cerrado (lo
 * hace el backend). Cualquier otro campo de la respuesta del modelo, como un texto, se descarta aquí.
 */
export interface Interpretacion {
  intencion: string;
  argumentos: Readonly<Record<string, unknown>>;
  /** Tokens que informa el proveedor (para el registro), o null si no los informa. */
  tokensEntrada: number | null;
  tokensSalida: number | null;
}

/** Por qué no hubo respuesta. Ninguno lleva el contenido de la pregunta ni la llave. */
export type MotivoNoDisponible = 'TIEMPO_AGOTADO' | 'ERROR' | 'RESPUESTA_INVALIDA' | 'SIN_PROVEEDOR';

/**
 * La única falla que puede lanzar un AIProvider (PR20). El asistente la convierte en 503 ASISTENTE_NO_DISPONIBLE con
 * la alternativa manual y devuelve la cuota (contracts/asistente.md §1).
 */
export class ProveedorIANoDisponible extends Error {
  constructor(
    readonly motivo: MotivoNoDisponible,
    readonly estadoHttp: number | null = null,
  ) {
    super(`El proveedor de IA no está disponible (${motivo}${estadoHttp ? ` ${estadoHttp}` : ''})`);
    this.name = 'ProveedorIANoDisponible';
  }

  /** ADR-027: solo un 429 o un 5xx inmediato admite un reintento, dentro del presupuesto de 3 s. */
  get reintentable(): boolean {
    return this.estadoHttp !== null && (this.estadoHttp === 429 || this.estadoHttp >= 500);
  }
}

export abstract class AIProvider {
  /**
   * Clasifica la pregunta. Respeta `senal` (el tiempo límite): si se aborta, lanza ProveedorIANoDisponible con
   * TIEMPO_AGOTADO. Cualquier otra falla también es ProveedorIANoDisponible; nunca devuelve otra cosa.
   */
  abstract interpretar(solicitud: SolicitudDeInterpretacion, senal: AbortSignal): Promise<Interpretacion>;
}

const esObjetoPlano = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === 'object' && valor !== null && !Array.isArray(valor);

/**
 * Lee la respuesta ya convertida de JSON de un proveedor: se queda solo con `intencion` (texto) y `argumentos`
 * (objeto; si falta, vacío). Cualquier otra forma es RESPUESTA_INVALIDA. La comparten los adaptadores.
 */
export function leerInterpretacion(
  valor: unknown,
  tokens: { entrada: number | null; salida: number | null } = { entrada: null, salida: null },
): Interpretacion {
  if (!esObjetoPlano(valor) || typeof valor.intencion !== 'string' || valor.intencion.trim() === '') {
    throw new ProveedorIANoDisponible('RESPUESTA_INVALIDA');
  }
  const argumentos = valor.argumentos === undefined ? {} : valor.argumentos;
  if (!esObjetoPlano(argumentos)) throw new ProveedorIANoDisponible('RESPUESTA_INVALIDA');
  return {
    intencion: valor.intencion.trim(),
    argumentos: { ...argumentos },
    tokensEntrada: tokens.entrada,
    tokensSalida: tokens.salida,
  };
}
