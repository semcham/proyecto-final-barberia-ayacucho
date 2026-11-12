import type { TipoAviso, TipoDestinatario } from './aviso';

// T069 de 004 · Plantillas de texto simple de los avisos de cita (FR-013, FR-014; principio VII, datos mínimos).
// La plantilla solo ve `DatosDelAviso`, que `datosDelEvento` arma con una lista cerrada de campos: aunque un
// evento trajera de más, el mensaje no puede llevar el teléfono, el correo ni datos de otras citas. La fecha y la
// hora se escriben en la zona de la barbería.

export interface DatosDelAviso {
  barberia: string;
  servicio: string;
  barbero: string;
  /** Instante ISO 8601. */
  inicio: string;
  /** Solo en la reprogramación. */
  inicioAnterior?: string;
  zonaHoraria: string;
}

export interface MensajeCompuesto {
  asunto: string;
  texto: string;
}

const texto = (valor: unknown): string => (typeof valor === 'string' ? valor : '');

/** Los únicos campos del evento que llegan a la plantilla, más el nombre de la barbería leído de M01. */
export function datosDelEvento(payload: Record<string, unknown>, barberia: string): DatosDelAviso {
  const datos: DatosDelAviso = {
    barberia,
    servicio: texto(payload.servicio),
    barbero: texto(payload.barbero),
    inicio: texto(payload.inicio),
    zonaHoraria: texto(payload.zonaHoraria) || 'America/Lima',
  };
  const anterior = texto(payload.inicioAnterior);
  if (anterior) datos.inicioAnterior = anterior;
  return datos;
}

function fecha(instante: string, zona: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: zona,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instante));
}

function hora(instante: string, zona: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instante));
}

const cuando = (instante: string, zona: string) =>
  `${fecha(instante, zona)}, a las ${hora(instante, zona)} (hora de la barbería)`;

const PIE = 'Este es un mensaje automático de la plataforma de reservas. No respondas a este correo.';

/** Las tres direcciones del recordatorio (URL_PUBLICA/e#<token>), una por acción (fase 4, RF34). */
export interface EnlacesDelRecordatorio {
  confirmar: string;
  reprogramar: string;
  cancelar: string;
}

/**
 * Asunto y texto de un aviso de cita para su destinatario. El RECORDATORIO (fase 4) lleva además los tres enlaces
 * de un solo uso: sin ellos no se compone.
 */
export function componerAviso(
  tipo: TipoAviso,
  para: TipoDestinatario,
  datos: DatosDelAviso,
  enlaces?: EnlacesDelRecordatorio,
): MensajeCompuesto {
  const { barberia, servicio, barbero, inicio, inicioAnterior, zonaHoraria: zona } = datos;
  const detalle = [`Servicio: ${servicio}`, `Barbero: ${barbero}`, `Barbería: ${barberia}`];
  const alCliente = para === 'CLIENTE';

  let asunto: string;
  let cuerpo: string[];
  switch (tipo) {
    case 'CITA_CREADA':
      asunto = `Cita confirmada en ${barberia}`;
      cuerpo = ['Tu cita quedó confirmada.', '', `Fecha: ${cuando(inicio, zona)}`, ...detalle];
      break;
    case 'CITA_CANCELADA':
      asunto = alCliente ? `Cita cancelada en ${barberia}` : `Un cliente canceló su cita en ${barberia}`;
      cuerpo = [
        alCliente ? 'Tu cita fue cancelada.' : 'El cliente canceló su cita. El horario quedó libre.',
        '',
        `Fecha: ${cuando(inicio, zona)}`,
        ...detalle,
      ];
      break;
    case 'CITA_REPROGRAMADA':
      asunto = alCliente
        ? `Cita reprogramada en ${barberia}`
        : `Un cliente reprogramó su cita en ${barberia}`;
      cuerpo = [
        alCliente ? 'Tu cita cambió de hora.' : 'El cliente reprogramó su cita.',
        '',
        ...(inicioAnterior ? [`Antes: ${cuando(inicioAnterior, zona)}`] : []),
        `Ahora: ${cuando(inicio, zona)}`,
        ...detalle,
      ];
      break;
    case 'RECORDATORIO':
      if (!enlaces) throw new Error('El recordatorio necesita sus tres enlaces');
      asunto = `Recordatorio: tu cita de hoy en ${barberia}`;
      cuerpo = [
        'Te recordamos tu cita de hoy.',
        '',
        `Fecha: ${cuando(inicio, zona)}`,
        ...detalle,
        '',
        'Cada enlace sirve una sola vez y solo para esta cita, hasta su hora de inicio:',
        `Confirmo mi asistencia: ${enlaces.confirmar}`,
        `Reprogramar: ${enlaces.reprogramar}`,
        `Cancelar: ${enlaces.cancelar}`,
        '',
        'Si no respondes, tu cita sigue en pie.',
      ];
      break;
    default:
      throw new Error(`No hay plantilla de cita para el aviso ${tipo}`);
  }
  return { asunto: asunto.slice(0, 120), texto: [...cuerpo, '', PIE].join('\n') };
}

// ---------------------------------------------------------------------------------------------------------------
// Fase 6 (T129; US5; FR-036, FR-039) · Avisos de suscripción al propietario, en texto simple. Solo lo necesario: el
// nombre de la barbería, el hecho, la fecha que corresponde y, en un rechazo, el motivo. `datosDeSuscripcion` arma
// una lista CERRADA de campos: nunca llegan a la plantilla el importe, el número de operación, las referencias del
// pago ni datos del comprobante, aunque el evento los trajera.

export interface DatosDeSuscripcion {
  barberia: string;
  zonaHoraria: string;
  /** Instantes ISO 8601, según el hecho. */
  finPrueba?: string;
  finGracia?: string;
  vencidaEn?: string;
  periodoDesde?: string;
  periodoHasta?: string;
  plan?: string;
  /** Solo en un rechazo, si lo hay (el que escribió el administrador al revisar la transferencia). */
  motivo?: string;
}

const CAMPOS_DE_SUSCRIPCION = [
  'finPrueba',
  'finGracia',
  'vencidaEn',
  'periodoDesde',
  'periodoHasta',
  'plan',
  'motivo',
] as const;

export function datosDeSuscripcion(
  payload: Record<string, unknown>,
  barberia: string,
  zonaHoraria: string,
): DatosDeSuscripcion {
  const datos: DatosDeSuscripcion = { barberia, zonaHoraria: zonaHoraria || 'America/Lima' };
  for (const campo of CAMPOS_DE_SUSCRIPCION) {
    const valor = texto(payload[campo]).trim();
    if (valor) datos[campo] = valor;
  }
  return datos;
}

const IR_AL_PANEL = 'Puedes hacerlo desde el panel de tu barbería, en la sección Suscripción.';

/** Asunto y texto de un aviso de suscripción, siempre para el propietario. */
export function componerAvisoDeSuscripcion(tipo: TipoAviso, datos: DatosDeSuscripcion): MensajeCompuesto {
  const { barberia, zonaHoraria: zona } = datos;
  const dia = (instante: string | undefined) =>
    instante ? fecha(instante, zona) : 'la fecha indicada en tu panel';
  const momento = (instante: string | undefined) =>
    instante ? cuando(instante, zona) : 'la fecha indicada en tu panel';

  let asunto: string;
  let cuerpo: string[];
  switch (tipo) {
    case 'PRUEBA_POR_TERMINAR':
      asunto = `Tu prueba gratuita termina pronto en ${barberia}`;
      cuerpo = [
        `La prueba gratuita de ${barberia} termina el ${momento(datos.finPrueba)}.`,
        '',
        'Para seguir recibiendo reservas sin interrupción, puedes elegir un plan antes de esa fecha.',
        IR_AL_PANEL,
      ];
      break;
    case 'SUSCRIPCION_EN_GRACIA':
      asunto = `Tu suscripción está en período de gracia (${barberia})`;
      cuerpo = [
        `El período pagado de ${barberia} terminó sin un pago para el siguiente.`,
        '',
        `Puedes pagar hasta el ${momento(datos.finGracia)} sin dejar de recibir reservas.`,
        IR_AL_PANEL,
      ];
      break;
    case 'SUSCRIPCION_VENCIDA':
      asunto = `Tu suscripción venció (${barberia})`;
      cuerpo = [
        `La suscripción de ${barberia} venció el ${momento(datos.vencidaEn)}.`,
        '',
        'Desde ahora la barbería ya no acepta reservas nuevas. Las citas ya reservadas siguen en pie.',
        `Al pagar un plan, vuelve a aceptarlas de inmediato. ${IR_AL_PANEL}`,
      ];
      break;
    case 'PAGO_APROBADO':
      asunto = `Pago aprobado (${barberia})`;
      cuerpo = [
        `Recibimos tu pago de la suscripción de ${barberia} y quedó aprobado.`,
        '',
        `Plan: ${datos.plan ?? 'el plan elegido'}`,
        `Período: del ${dia(datos.periodoDesde)} al ${dia(datos.periodoHasta)}`,
      ];
      break;
    case 'PAGO_RECHAZADO':
      asunto = `Pago rechazado (${barberia})`;
      cuerpo = [
        `Tu pago de la suscripción de ${barberia}${datos.plan ? ` (plan ${datos.plan})` : ''} no se pudo completar.`,
        ...(datos.motivo ? ['', `Motivo: ${datos.motivo}`] : []),
        '',
        `Puedes intentarlo de nuevo. ${IR_AL_PANEL}`,
      ];
      break;
    default:
      throw new Error(`No hay plantilla de suscripción para el aviso ${tipo}`);
  }
  return { asunto: asunto.slice(0, 120), texto: [...cuerpo, '', PIE].join('\n') };
}
