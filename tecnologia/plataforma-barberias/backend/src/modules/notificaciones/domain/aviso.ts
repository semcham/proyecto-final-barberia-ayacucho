// T069 de 004 · Aviso de M05 (data-model.md §4). Un aviso por destinatario de un evento; no guarda el texto del
// mensaje ni datos de contacto: se componen al enviar (research R12).
//
//   PENDIENTE ──reclamo──▶ ENVIANDO ──aceptado──▶ ENVIADO
//       ▲                     │  ├──aceptado por correo tras fallar WhatsApp──▶ ENVIADO_RESPALDO (fase 5)
//       └──error temporal─────┘  ├──sin intentos o error permanente──▶ FALLIDO
//                                └──pasó discard_after, cita cambiada o sin canal──▶ DESCARTADO

export const TIPOS_DE_AVISO = [
  'CITA_CREADA',
  'CITA_CANCELADA',
  'CITA_REPROGRAMADA',
  'RECORDATORIO',
  'PRUEBA_POR_TERMINAR',
  'SUSCRIPCION_EN_GRACIA',
  'SUSCRIPCION_VENCIDA',
  'PAGO_APROBADO',
  'PAGO_RECHAZADO',
  // Funcionalidad 008 (contracts/eventos.md §3 de 008, migración 0030).
  'ADELANTO_SOLICITADO',
  'PAGO_ADELANTO_REGISTRADO',
  'ADELANTO_CONFIRMADO',
  'PAGO_ADELANTO_RECHAZADO',
  'ADELANTO_VENCIDO',
  // Funcionalidad 010 (contracts/eventos-y-avisos.md §2 de 010, migración 0036).
  'VERIFICAR_CORREO',
  'RECUPERAR_CONTRASENA',
  'CONTRASENA_CAMBIADA',
] as const;
export type TipoAviso = (typeof TIPOS_DE_AVISO)[number];

export type EstadoAviso =
  'PENDIENTE' | 'ENVIANDO' | 'ENVIADO' | 'ENVIADO_RESPALDO' | 'FALLIDO' | 'DESCARTADO';
export const ESTADOS_FINALES: readonly EstadoAviso[] = [
  'ENVIADO',
  'ENVIADO_RESPALDO',
  'FALLIDO',
  'DESCARTADO',
];

/** Código del último error (`notification.last_error`): nunca el texto del proveedor. */
export type CodigoErrorAviso =
  'TIEMPO_AGOTADO' | 'CANAL_NO_DISPONIBLE' | 'DESTINATARIO_INVALIDO' | 'SIN_CANAL';

export type TipoDestinatario = 'CLIENTE' | 'PROPIETARIO' | 'BARBERO' | 'CUENTA';

/**
 * A quién va el aviso, sin datos de contacto. `ref` es el perfil del cliente, el usuario del barbero o, para el
 * propietario, la barbería (tenant): su correo se resuelve al enviar con `BarberiasApi.correoDelPropietario`.
 * 010: `CUENTA` es la cuenta de una persona (`ref` = su usuario), sea cliente o personal; su correo se resuelve al
 * enviar con `CuentasApi.correoDeCuenta`.
 */
export interface Destinatario {
  tipo: TipoDestinatario;
  ref: string;
}

/** Tipo de aviso de cada evento de cita (contracts/eventos.md §3). */
export const AVISO_POR_EVENTO_DE_CITA: Readonly<Record<string, TipoAviso>> = {
  CitaCreada: 'CITA_CREADA',
  CitaCancelada: 'CITA_CANCELADA',
  CitaReprogramada: 'CITA_REPROGRAMADA',
};

/** Plazo de un aviso de cita: sin enviar a las 24 h desde su creación, queda FALLIDO (FR-033, R13). */
export const PLAZO_AVISO_DE_CITA_MS = 24 * 60 * 60 * 1000;

/**
 * Fase 6 (US5) · Tipo de aviso de cada evento de suscripción (contracts/eventos.md §3). Van solo al propietario, por
 * correo (§4). Su plazo es el de los demás avisos que no son recordatorio: creación + 24 h (data-model §4).
 */
export const AVISO_POR_EVENTO_DE_SUSCRIPCION: Readonly<Record<string, TipoAviso>> = {
  PruebaPorTerminar: 'PRUEBA_POR_TERMINAR',
  SuscripcionEnGracia: 'SUSCRIPCION_EN_GRACIA',
  SuscripcionVencida: 'SUSCRIPCION_VENCIDA',
  PagoAprobado: 'PAGO_APROBADO',
  PagoRechazado: 'PAGO_RECHAZADO',
};

export const TIPOS_DE_AVISO_DE_SUSCRIPCION: readonly TipoAviso[] = Object.values(
  AVISO_POR_EVENTO_DE_SUSCRIPCION,
);

export const PLAZO_AVISO_DE_SUSCRIPCION_MS = 24 * 60 * 60 * 1000;

/**
 * 008 · Tipo de aviso de cada evento del adelanto (specs/008-adelanto-reserva-qr/contracts/eventos.md §3). Su plazo
 * es el de los demás avisos que no son recordatorio: creación + 24 h. El manejador llega en las fases de 008.
 */
export const AVISO_POR_EVENTO_DE_ADELANTO: Readonly<Record<string, TipoAviso>> = {
  AdelantoSolicitado: 'ADELANTO_SOLICITADO',
  PagoDeAdelantoRegistrado: 'PAGO_ADELANTO_REGISTRADO',
  AdelantoConfirmado: 'ADELANTO_CONFIRMADO',
  PagoDeAdelantoRechazado: 'PAGO_ADELANTO_RECHAZADO',
  AdelantoVencido: 'ADELANTO_VENCIDO',
};

export const TIPOS_DE_AVISO_DE_ADELANTO: readonly TipoAviso[] = Object.values(AVISO_POR_EVENTO_DE_ADELANTO);

/**
 * 008 (contracts/eventos.md §3): a quién va cada aviso del adelanto. El cliente, por su canal elegido; el
 * propietario, por correo (`ref` es la barbería). Las fases 4 y 5 suman sus eventos.
 */
export const DESTINATARIOS_POR_EVENTO_DE_ADELANTO: Readonly<Record<string, readonly TipoDestinatario[]>> = {
  AdelantoSolicitado: ['CLIENTE'],
  PagoDeAdelantoRegistrado: ['PROPIETARIO'],
  // Fase 4 (US3).
  AdelantoConfirmado: ['CLIENTE'],
  PagoDeAdelantoRechazado: ['CLIENTE'],
  // Fase 5 (US4): la cita se canceló sola; el horario quedó libre.
  AdelantoVencido: ['CLIENTE', 'PROPIETARIO'],
};

/** Plazo de un aviso del adelanto: el de los avisos que no son recordatorio, creación + 24 h. */
export const PLAZO_AVISO_DE_ADELANTO_MS = 24 * 60 * 60 * 1000;

/**
 * 010 (contracts/eventos-y-avisos.md §2 de 010) · Avisos de la cuenta: van a la CUENTA, siempre por correo (el canal
 * elegido del cliente no aplica). Los del enlace llevan un token que se emite al enviar.
 */
export const TIPOS_DE_AVISO_DE_CUENTA: readonly TipoAviso[] = [
  'VERIFICAR_CORREO',
  'RECUPERAR_CONTRASENA',
  'CONTRASENA_CAMBIADA',
];

/** Los avisos con enlace de cuenta: se descartan (no "fallan") si su enlace venció o ya no sirve. */
export const TIPOS_DE_AVISO_CON_ENLACE_DE_CUENTA: readonly TipoAviso[] = [
  'VERIFICAR_CORREO',
  'RECUPERAR_CONTRASENA',
];

/** Aviso de cada propósito de `EnlaceDeCuentaSolicitado`. */
export const AVISO_POR_PROPOSITO_DE_ENLACE: Readonly<Record<string, TipoAviso>> = {
  VERIFICAR_CORREO: 'VERIFICAR_CORREO',
  RECUPERAR_CONTRASENA: 'RECUPERAR_CONTRASENA',
};

/** Plazo del aviso de contraseña cambiada: creación + 24 h. Los del enlace se descartan al vencer el enlace. */
export const PLAZO_AVISO_DE_CUENTA_MS = 24 * 60 * 60 * 1000;

/**
 * ¿El aviso se DESCARTA (en vez de quedar FALLIDO) cuando ya no llegará a tiempo? El recordatorio (la cita empezó) y
 * los avisos con enlace de cuenta (el enlace venció): no son un fallo del canal.
 */
export const seDescartaAlVencer = (tipo: TipoAviso): boolean =>
  tipo === 'RECORDATORIO' || TIPOS_DE_AVISO_CON_ENLACE_DE_CUENTA.includes(tipo);
