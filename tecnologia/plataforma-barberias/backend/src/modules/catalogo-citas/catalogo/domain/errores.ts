import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T026 · Errores esperados de M02. El host los traduce a HTTP según su `codigo` (contracts/openapi.yaml
// de 002). Los usan los submódulos catalogo y citas.

export class DatoInvalido extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  constructor(campo: string, problema: string) {
    super('Revisa los datos enviados.', [{ campo, problema }]);
  }
}

export class NoEncontrado extends ErrorDeAplicacion {
  readonly codigo = 'NO_ENCONTRADO';
  constructor() {
    // También para recursos de otra barbería o de otro cliente o barbero: no revela que existen.
    super('No se encontró el recurso solicitado.');
  }
}

export class AccesoDenegado extends ErrorDeAplicacion {
  readonly codigo = 'ACCESO_DENEGADO';
  constructor() {
    super('No tienes permiso para realizar esta operación.');
  }
}

export class NombreDuplicado extends ErrorDeAplicacion {
  readonly codigo = 'NOMBRE_DUPLICADO';
  constructor() {
    super('Ya existe un servicio con ese nombre en tu barbería.');
  }
}

/** Cita activa afectada por un cambio; sin datos del cliente (research R11). */
export interface CitaAfectada {
  id: string;
  inicio: string;
  barberoId: string;
  servicio: string;
}

export class ConflictoConCitas extends ErrorDeAplicacion {
  readonly codigo = 'CONFLICTO_CON_CITAS';
  constructor(citas: readonly CitaAfectada[]) {
    super('El cambio deja citas activas en conflicto. Confírmalo para guardarlo sin tocar las citas.', [
      ...citas.map((cita) => ({ ...cita })),
    ]);
  }
}

export class FueraDelHorarioDeAtencion extends ErrorDeAplicacion {
  readonly codigo = 'FUERA_DEL_HORARIO_DE_ATENCION';
  constructor(diaSemana?: number) {
    super('La disponibilidad debe quedar dentro del horario de atención de la barbería.', [{ diaSemana }]);
  }
}

export class LimiteBarberosAlcanzado extends ErrorDeAplicacion {
  readonly codigo = 'SUSCRIPCION_NO_PERMITE';
  constructor(maximo: number) {
    super('Tu plan no permite más barberos activos.', [{ motivo: 'LIMITE_BARBEROS', maximo }]);
  }
}

export class UsuarioYaVinculado extends ErrorDeAplicacion {
  readonly codigo = 'USUARIO_YA_VINCULADO';
  constructor() {
    super('Ese usuario ya está vinculado a otro barbero.');
  }
}

export class HorarioNoDisponible extends ErrorDeAplicacion {
  readonly codigo = 'HORARIO_NO_DISPONIBLE';
  constructor() {
    super('Ese horario ya no está disponible. Elige otra hora.');
  }
}

export class CitaSolapadaDelCliente extends ErrorDeAplicacion {
  readonly codigo = 'CITA_SOLAPADA_DEL_CLIENTE';
  constructor() {
    super('Ya tienes otra cita a esa hora.');
  }
}

export type MotivoReservaInvalida =
  | 'HORA_PASADA'
  | 'FUERA_DEL_HORIZONTE'
  | 'FUERA_DE_DISPONIBILIDAD'
  | 'EN_BLOQUEO'
  | 'SERVICIO_INACTIVO'
  | 'BARBERO_INACTIVO'
  | 'BARBERO_NO_OFRECE_SERVICIO';

export class ReservaInvalida extends ErrorDeAplicacion {
  readonly codigo = 'RESERVA_INVALIDA';
  constructor(motivo: MotivoReservaInvalida) {
    super('No se puede reservar esa hora.', [{ motivo }]);
  }
}

export class IdempotenciaConflicto extends ErrorDeAplicacion {
  readonly codigo = 'IDEMPOTENCIA_CONFLICTO';
  constructor() {
    super('Esa clave de idempotencia ya se usó con otra reserva.');
  }
}

export class TransicionInvalida extends ErrorDeAplicacion {
  readonly codigo = 'TRANSICION_INVALIDA';
  constructor(desde: string, hacia: string) {
    super('Ese cambio de estado no es válido para la cita.', [{ desde, hacia }]);
  }
}
