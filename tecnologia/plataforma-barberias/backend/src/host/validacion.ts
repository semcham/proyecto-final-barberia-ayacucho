import { ValidationPipe, type ValidationError } from '@nestjs/common';
import { ErrorDeAplicacion } from '../shared';

/** Error de formato de la solicitud (400 VALIDACION) con la lista de campos y problemas. */
export class SolicitudInvalida extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
}

function aplanar(errores: ValidationError[], prefijo = ''): Record<string, unknown>[] {
  return errores.flatMap((error) => {
    const campo = prefijo ? `${prefijo}.${error.property}` : error.property;
    const propios = Object.keys(error.constraints ?? {}).map((restriccion) => ({
      campo,
      problema: restriccion === 'whitelistValidation' ? 'no_permitido' : restriccion,
    }));
    return [...propios, ...aplanar(error.children ?? [], campo)];
  });
}

/**
 * ValidationPipe global (R11): solo acepta campos declarados en los DTO. Un campo desconocido, como
 * `tenantId`, responde 400 en lugar de ignorarse.
 */
export function crearValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errores) => new SolicitudInvalida('Revisa los datos enviados.', aplanar(errores)),
  });
}
