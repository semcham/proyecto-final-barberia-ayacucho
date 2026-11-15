import type { Intencion, RolDelAsistente } from '../../domain/herramientas';

// T041 de 005 · Puerto del registro de preguntas (FR-010, research R09). NO recibe el texto de la pregunta ni de la
// respuesta, ni los argumentos: solo quién, el rol, la intención, el resultado, la duración y los tokens. Corre en la
// transacción del llamador. La implementación es infrastructure/kysely-registro.ts.

export type ResultadoDeLaPregunta =
  | 'RESPONDIDA'
  | 'SIN_DATOS'
  | 'FUERA_DE_ALCANCE'
  | 'ACCION_NO_PERMITIDA'
  | 'CUOTA_AGOTADA'
  | 'PROVEEDOR_NO_DISPONIBLE'
  | 'INVALIDA';

export interface PreguntaRegistrada {
  usuarioId: string;
  rol: RolDelAsistente;
  intencion: Intencion | null;
  resultado: ResultadoDeLaPregunta;
  duracionMs: number;
  tokensEntrada: number | null;
  tokensSalida: number | null;
}

export abstract class RegistroDePreguntas {
  abstract registrar(pregunta: PreguntaRegistrada): Promise<void>;
}
