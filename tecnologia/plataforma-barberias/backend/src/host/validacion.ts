import {
  type ArgumentMetadata,
  type PipeTransform,
  ValidationPipe,
  type ValidationError,
} from '@nestjs/common';
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

// Caracteres de control (C0 salvo tabulador y saltos de línea, y DEL). PostgreSQL no admite el byte nulo en
// un texto: sin este filtro, un "\u0000" en cualquier campo terminaría en 500 en vez de 400 (FR-051, EQ-10).
// eslint-disable-next-line no-control-regex
const CARACTER_DE_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function campoConControl(valor: unknown, ruta: string): string | null {
  if (typeof valor === 'string') return CARACTER_DE_CONTROL.test(valor) ? ruta : null;
  if (Array.isArray(valor)) {
    for (const [i, elemento] of valor.entries()) {
      const campo = campoConControl(elemento, `${ruta}[${i}]`);
      if (campo) return campo;
    }
  } else if (valor !== null && typeof valor === 'object') {
    for (const [clave, elemento] of Object.entries(valor)) {
      const campo = campoConControl(elemento, ruta ? `${ruta}.${clave}` : clave);
      if (campo) return campo;
    }
  }
  return null;
}

/**
 * Pipe global que se aplica antes del ValidationPipe: rechaza con 400 VALIDACION cualquier texto del cuerpo,
 * la consulta o la ruta con caracteres de control, sin reflejar su contenido.
 */
export class RechazarCaracteresDeControl implements PipeTransform {
  transform(valor: unknown, metadatos: ArgumentMetadata): unknown {
    if (metadatos.type === 'custom') return valor;
    const campo = campoConControl(valor, metadatos.type === 'param' ? (metadatos.data ?? '') : '');
    if (campo !== null) {
      throw new SolicitudInvalida('Revisa los datos enviados.', [
        { campo: campo || metadatos.type, problema: 'caracteres_no_permitidos' },
      ]);
    }
    return valor;
  }
}
