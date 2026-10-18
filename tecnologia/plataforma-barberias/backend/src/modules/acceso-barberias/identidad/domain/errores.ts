import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// Errores esperados de M01. El host los traduce a HTTP según su `codigo` (contracts/openapi.yaml).

export class ValorInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  constructor(campo: string, problema: string) {
    super('Revisa los datos enviados.', [{ campo, problema }]);
  }
}

export class CredencialesInvalidas extends ErrorDeAplicacion {
  readonly codigo = 'CREDENCIALES_INVALIDAS';
  constructor() {
    super('Correo o contraseña incorrectos.');
  }
}

export class AccesoSuspendido extends ErrorDeAplicacion {
  readonly codigo = 'ACCESO_SUSPENDIDO';
  constructor() {
    super('Tu acceso está suspendido. Comunícate con el propietario de la barbería.');
  }
}

export class NoAutenticado extends ErrorDeAplicacion {
  readonly codigo = 'NO_AUTENTICADO';
  constructor() {
    super('Inicia sesión para continuar.');
  }
}

export class AccesoDenegado extends ErrorDeAplicacion {
  readonly codigo = 'ACCESO_DENEGADO';
  constructor() {
    super('No tienes permiso para realizar esta operación.');
  }
}

export class CorreoNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'CORREO_NO_DISPONIBLE';
  constructor() {
    // No revela a qué barbería pertenece el correo (FR-006).
    super('Ese correo no está disponible. Usa otro correo.');
  }
}

export class NoEncontrado extends ErrorDeAplicacion {
  readonly codigo = 'NO_ENCONTRADO';
  constructor() {
    super('No se encontró el recurso solicitado.');
  }
}

export class OperacionNoPermitida extends ErrorDeAplicacion {
  readonly codigo = 'OPERACION_NO_PERMITIDA';
  constructor(mensaje: string) {
    super(mensaje);
  }
}

export class EnlaceInvalido extends ErrorDeAplicacion {
  readonly codigo = 'ENLACE_INVALIDO';
  constructor() {
    // Mismo mensaje para inexistente, vencido, usado o revocado.
    super('El enlace no es válido o ya venció. Pide uno nuevo al propietario.');
  }
}

export class LimiteUsuariosAlcanzado extends ErrorDeAplicacion {
  readonly codigo = 'SUSCRIPCION_NO_PERMITE';
  constructor(maximo: number) {
    super('Tu plan no permite agregar más usuarios.', [{ motivo: 'LIMITE_USUARIOS', maximo }]);
  }
}

// --- Funcionalidad 002: cuenta de cliente (ADR-020) ---

export class IngresaDesdeTuBarberia extends ErrorDeAplicacion {
  readonly codigo = 'INGRESA_DESDE_TU_BARBERIA';
  constructor() {
    super('Ingresa desde el enlace de tu barbería para ver y reservar tus citas.');
  }
}

export class UnirseRequiereConsentimiento extends ErrorDeAplicacion {
  readonly codigo = 'UNIRSE_REQUIERE_CONSENTIMIENTO';
  constructor() {
    super('Para reservar en esta barbería, acepta su política de tratamiento de datos.');
  }
}

export class CuentaDePersonal extends ErrorDeAplicacion {
  readonly codigo = 'CUENTA_DE_PERSONAL';
  constructor() {
    super('Esta cuenta es del personal de una barbería y no puede usarse como cliente.');
  }
}

export class DemasiadosIntentos extends ErrorDeAplicacion {
  readonly codigo = 'DEMASIADOS_INTENTOS';
  constructor(readonly reintentarEnSegundos: number) {
    super('Demasiados intentos. Espera un momento antes de volver a intentar.', [{ reintentarEnSegundos }]);
  }
}
