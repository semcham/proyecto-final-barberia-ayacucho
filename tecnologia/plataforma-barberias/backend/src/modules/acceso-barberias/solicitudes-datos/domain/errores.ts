import { ErrorDeAplicacion } from '../../../../shared/nucleo';

// T009 de 007 · Errores de las solicitudes sobre datos personales (contracts/openapi.yaml de 007). Ninguno repite el
// texto recibido: el detalle, la respuesta y el motivo nunca salen en un error ni en un registro.

/** Ya hay una abierta del mismo tipo para ese titular en la barbería (FR-011). 409, con el id de la existente. */
export class SolicitudAbierta extends ErrorDeAplicacion {
  readonly codigo = 'SOLICITUD_ABIERTA';
  constructor(solicitudId: string) {
    super('Ya hay una solicitud abierta de este tipo. Puedes ver su estado en la lista.', [{ solicitudId }]);
  }
}

/** La solicitud ya está atendida o rechazada: es un estado final. 409. */
export class SolicitudCerrada extends ErrorDeAplicacion {
  readonly codigo = 'SOLICITUD_CERRADA';
  constructor() {
    super('La solicitud ya está cerrada. Para pedir algo más, se registra una nueva.');
  }
}

/** Se pidió iniciar la atención de una que ya está en atención. 409. */
export class SolicitudYaEnAtencion extends ErrorDeAplicacion {
  readonly codigo = 'SOLICITUD_YA_EN_ATENCION';
  constructor() {
    super('La solicitud ya está en atención.');
  }
}

/** No existe en la barbería del token (también la de otra barbería: misma respuesta). 404. */
export class SolicitudNoEncontrada extends ErrorDeAplicacion {
  readonly codigo = 'SOLICITUD_NO_ENCONTRADA';
  constructor() {
    super('No se encontró la solicitud.');
  }
}

/** "En nombre de" con un cliente que no existe en la barbería del token. 404. */
export class ClienteNoEncontrado extends ErrorDeAplicacion {
  readonly codigo = 'CLIENTE_NO_ENCONTRADO';
  constructor() {
    super('No se encontró ese cliente en tu barbería.');
  }
}

type CampoSolicitud = 'detalle' | 'respuesta' | 'motivo';
type ProblemaSolicitud = 'requerido' | 'largo';

const MENSAJES: Record<CampoSolicitud, string> = {
  detalle: 'Escribe qué dato quieres corregir y cómo (hasta 500 caracteres).',
  respuesta: 'Escribe qué hiciste y qué se conserva por obligación (hasta 1 000 caracteres).',
  motivo: 'Escribe el motivo del rechazo, de 5 a 300 caracteres.',
};

/**
 * Una regla del dominio no se cumple: rectificación sin detalle, atender sin respuesta o rechazar sin motivo.
 * Código VALIDACION con 422 y el campo en detalles[0] (el cuerpo bien formado lo valida el DTO con 400).
 */
export class ValidacionSolicitud extends ErrorDeAplicacion {
  readonly codigo = 'VALIDACION';
  readonly estadoHttp = 422;
  constructor(campo: CampoSolicitud, problema: ProblemaSolicitud) {
    super(MENSAJES[campo], [{ campo, problema }]);
  }
}
