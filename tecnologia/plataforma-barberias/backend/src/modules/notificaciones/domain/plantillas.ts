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

/** Asunto y texto de un aviso de cita para su destinatario. Solo los tipos de cita (fase 3). */
export function componerAviso(
  tipo: TipoAviso,
  para: TipoDestinatario,
  datos: DatosDelAviso,
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
    default:
      throw new Error(`No hay plantilla de cita para el aviso ${tipo}`);
  }
  return { asunto: asunto.slice(0, 120), texto: [...cuerpo, '', PIE].join('\n') };
}
