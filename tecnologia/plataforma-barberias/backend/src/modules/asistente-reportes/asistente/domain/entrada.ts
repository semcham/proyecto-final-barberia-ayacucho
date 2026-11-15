import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T040 de 005 · La pregunta y el contexto de la conversación (FR-012, FR-013, contracts/asistente.md §1). Los valida
// el CASO DE USO, no el DTO, para que una pregunta inválida quede registrada como INVALIDA (SC-007). Nada se recorta
// en silencio: lo que no cumple es 422 VALIDACION con el campo.

export const MAXIMO_CARACTERES = 500;
export const MAXIMO_INTERVENCIONES = 6;

/** Una intervención previa de la conversación abierta (el servidor no guarda historial). */
export interface IntervencionPrevia {
  de: 'USUARIO' | 'ASISTENTE';
  texto: string;
}

export interface Entrada {
  mensaje: string;
  contexto: IntervencionPrevia[];
}

export class EntradaInvalida extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  /** El contrato de POST /asistente/mensajes pide 422 (el código VALIDACION es 400 en el resto de las rutas). */
  readonly estadoHttp = 422;

  constructor(campo: string, problema: string, mensaje: string) {
    super(mensaje, [{ campo, problema }]);
  }
}

const textoValido = (valor: unknown): valor is string =>
  typeof valor === 'string' && valor.trim() !== '' && valor.length <= MAXIMO_CARACTERES;

export function validarEntrada(cuerpo: { mensaje?: unknown; contexto?: unknown }): Entrada {
  const { mensaje, contexto } = cuerpo;
  if (typeof mensaje !== 'string' || mensaje.trim() === '') {
    throw new EntradaInvalida('mensaje', 'obligatorio', 'Escribe tu pregunta.');
  }
  if (mensaje.length > MAXIMO_CARACTERES) {
    throw new EntradaInvalida(
      'mensaje',
      'maximo_500',
      `La pregunta puede tener como máximo ${MAXIMO_CARACTERES} caracteres.`,
    );
  }
  if (contexto === undefined || contexto === null) return { mensaje: mensaje.trim(), contexto: [] };
  if (!Array.isArray(contexto)) {
    throw new EntradaInvalida('contexto', 'formato', 'La conversación enviada no es válida.');
  }
  if (contexto.length > MAXIMO_INTERVENCIONES) {
    throw new EntradaInvalida(
      'contexto',
      `maximo_${MAXIMO_INTERVENCIONES}`,
      `Se envían como máximo las últimas ${MAXIMO_INTERVENCIONES} intervenciones.`,
    );
  }
  const intervenciones = contexto.map((intervencion, i): IntervencionPrevia => {
    if (typeof intervencion !== 'object' || intervencion === null || Array.isArray(intervencion)) {
      throw new EntradaInvalida(`contexto[${i}]`, 'formato', 'La conversación enviada no es válida.');
    }
    const { de, texto } = intervencion as Record<string, unknown>;
    if (de !== 'USUARIO' && de !== 'ASISTENTE') {
      throw new EntradaInvalida(`contexto[${i}].de`, 'formato', 'La conversación enviada no es válida.');
    }
    if (!textoValido(texto)) {
      throw new EntradaInvalida(`contexto[${i}].texto`, 'formato', 'La conversación enviada no es válida.');
    }
    return { de, texto };
  });
  return { mensaje: mensaje.trim(), contexto: intervenciones };
}
