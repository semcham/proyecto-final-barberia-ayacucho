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

export type TipoDestinatario = 'CLIENTE' | 'PROPIETARIO' | 'BARBERO';

/**
 * A quién va el aviso, sin datos de contacto. `ref` es el perfil del cliente, el usuario del barbero o, para el
 * propietario, la barbería (tenant): su correo se resuelve al enviar con `BarberiasApi.correoDelPropietario`.
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
