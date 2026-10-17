import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ErrorDeAplicacion } from '../shared';

interface CuerpoError {
  codigo: string;
  mensaje: string;
  detalles: Record<string, unknown>[];
}

/** Estado HTTP de cada código de error del contrato (contracts/openapi.yaml de 001 y 002). */
export const ESTADO_POR_CODIGO: Record<string, number> = {
  VALIDACION: 400,
  ENLACE_INVALIDO: 400,
  NO_AUTENTICADO: 401,
  CREDENCIALES_INVALIDAS: 401,
  ACCESO_SUSPENDIDO: 403,
  ACCESO_DENEGADO: 403,
  SUSCRIPCION_NO_PERMITE: 403,
  NO_ENCONTRADO: 404,
  CORREO_NO_DISPONIBLE: 409,
  OPERACION_NO_PERMITIDA: 422,
  DEMASIADOS_INTENTOS: 429,
  // Funcionalidad 002 (specs/002-catalogo-citas-cliente/contracts/openapi.yaml, T034).
  BARBERIA_NO_DISPONIBLE: 404,
  CONFLICTO_CON_CITAS: 409,
  HORARIO_NO_DISPONIBLE: 409,
  CITA_SOLAPADA_DEL_CLIENTE: 409,
  INGRESA_DESDE_TU_BARBERIA: 409,
  UNIRSE_REQUIERE_CONSENTIMIENTO: 409,
  CUENTA_DE_PERSONAL: 409,
  ENLACE_NO_DISPONIBLE: 409,
  NOMBRE_DUPLICADO: 409,
  USUARIO_YA_VINCULADO: 409,
  RESERVA_INVALIDA: 422,
  IDEMPOTENCIA_CONFLICTO: 422,
  TRANSICION_INVALIDA: 422,
  FUERA_DEL_HORARIO_DE_ATENCION: 422,
};

function desdeHttp(estado: number): CuerpoError {
  switch (estado) {
    case 400:
      return { codigo: 'VALIDACION', mensaje: 'Revisa los datos enviados.', detalles: [] };
    case 401:
      return { codigo: 'NO_AUTENTICADO', mensaje: 'Inicia sesión para continuar.', detalles: [] };
    case 403:
      return {
        codigo: 'ACCESO_DENEGADO',
        mensaje: 'No tienes permiso para realizar esta operación.',
        detalles: [],
      };
    case 404:
      return { codigo: 'NO_ENCONTRADO', mensaje: 'No se encontró el recurso solicitado.', detalles: [] };
    case 413:
      return {
        codigo: 'VALIDACION',
        mensaje: 'La solicitud es demasiado grande.',
        detalles: [{ problema: 'cuerpo_demasiado_grande' }],
      };
    case 429:
      return {
        codigo: 'DEMASIADOS_INTENTOS',
        mensaje: 'Demasiados intentos. Espera un momento antes de volver a intentar.',
        detalles: [],
      };
    default:
      return {
        codigo: 'ERROR_INTERNO',
        mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.',
        detalles: [],
      };
  }
}

/** Error 4xx de la librería http-errors (la usa el parser del cuerpo de Express); `expose` indica que es seguro. */
function esErrorHttpDelCliente(error: unknown): error is { status: number } {
  const candidato = error as { status?: unknown; expose?: unknown };
  return (
    typeof candidato?.status === 'number' &&
    candidato.status >= 400 &&
    candidato.status < 500 &&
    candidato.expose === true
  );
}

/**
 * Traduce cualquier error al formato único { codigo, mensaje, detalles } (R21). Nunca expone trazas ni
 * detalles internos; los errores no previstos se registran y responden 500 ERROR_INTERNO.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);

  catch(error: unknown, host: ArgumentsHost): void {
    const respuesta = host.switchToHttp().getResponse<Response>();
    let estado: number;
    let cuerpo: CuerpoError;

    if (error instanceof ErrorDeAplicacion) {
      estado = ESTADO_POR_CODIGO[error.codigo] ?? 500;
      cuerpo = { codigo: error.codigo, mensaje: error.message, detalles: error.detalles };
      const espera = error.detalles.find((detalle) => typeof detalle.reintentarEnSegundos === 'number');
      if (espera) respuesta.setHeader('Retry-After', String(espera.reintentarEnSegundos));
    } else if (error instanceof HttpException) {
      estado = error.getStatus();
      cuerpo = desdeHttp(estado);
    } else if (esErrorHttpDelCliente(error)) {
      // Errores del parser del cuerpo (http-errors): 413 por tamaño, 400 por JSON mal formado.
      estado = error.status;
      cuerpo = desdeHttp(estado);
    } else {
      estado = 500;
      cuerpo = desdeHttp(500);
    }

    if (estado >= 500) {
      // Solo el tipo y la traza; nunca el cuerpo de la solicitud (podría tener contraseñas).
      this.logger.error(error instanceof Error ? (error.stack ?? error.message) : 'Error no identificado');
    }
    respuesta.status(estado).json(cuerpo);
  }
}
