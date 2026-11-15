import type { FechaLocal } from '../../../../shared/nucleo';
import type { RolDelAsistente } from './herramientas';

// T040 de 005 · Las plantillas de respuesta (contracts/asistente.md §3, ADR-028). La respuesta la compone el backend
// con estas plantillas y SOLO los datos que devolvió la herramienta: el texto del modelo nunca llega al usuario
// (FR-001). Toda fecha se dice exacta (FR-014). Ofrecer reservar depende de que la barbería acepte reservas (FR-018).

export type ResultadoRespuesta = 'RESPONDIDA' | 'SIN_DATOS' | 'FUERA_DE_ALCANCE' | 'ACCION_NO_PERMITIDA';

export interface ContextoDeLaRespuesta {
  /** Nombre de la barbería del token. */
  barberia: string;
  /** Su enlace público, para los enlaces a Reservar. */
  slug: string;
  /** Si su suscripción permite reservar (SuscripcionesApi.estadoOperativo). */
  aceptaReservas: boolean;
}

export interface ServicioDeLaRespuesta {
  servicioId: string;
  nombre: string;
  precio: string;
  duracionMinutos: number;
  descripcion: string | null;
}

export interface BarberoDeLaRespuesta {
  barberoId: string;
  nombre: string;
}

export interface HoraDeLaRespuesta {
  /** ISO 8601 con el desplazamiento de la barbería. */
  inicio: string;
  barberos: BarberoDeLaRespuesta[];
  /** Ir a Reservar con el servicio, el barbero y la hora elegidos (solo si la barbería acepta reservas). */
  enlace?: string;
}

export type DatosDeLaRespuesta =
  | { tipo: 'SERVICIOS'; servicios: ServicioDeLaRespuesta[] }
  | { tipo: 'BARBEROS'; servicio: { servicioId: string; nombre: string }; barberos: BarberoDeLaRespuesta[] }
  | {
      tipo: 'HORARIOS';
      servicio: { servicioId: string; nombre: string };
      fecha: string;
      horas: HoraDeLaRespuesta[];
    };

export interface Sugerencia {
  tipo: 'RESERVAR' | 'MIS_CITAS' | 'REPORTES' | 'CONTACTAR_BARBERIA';
  enlace?: string;
}

export interface RespuestaCompuesta {
  resultado: ResultadoRespuesta;
  texto: string;
  datos?: DatosDeLaRespuesta;
  sugerencia?: Sugerencia;
}

/** "domingo 15 de noviembre de 2026": la fecha local tal cual, sin desplazarla por ninguna zona. */
export function fechaExacta(fecha: FechaLocal): string {
  return new Intl.DateTimeFormat('es-PE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(fecha.anio, fecha.mes - 1, fecha.dia)))
    .replace(',', '');
}

/** "a, b y c" (o "a, b o c"). */
function enumerar(partes: readonly string[], conjuncion: 'y' | 'o' = 'y'): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} ${conjuncion} ${partes[partes.length - 1]}`;
}

/** La hora local "HH:MM" de un instante ISO que ya viene con el desplazamiento de la barbería. */
const horaLocal = (inicio: string) => inicio.slice(11, 16);

function enlaceAReservar(slug: string, parametros: Record<string, string>): string {
  return `/b/${encodeURIComponent(slug)}/reservar?${new URLSearchParams(parametros).toString()}`;
}

export function plantillaServicios(
  ctx: ContextoDeLaRespuesta,
  servicios: ServicioDeLaRespuesta[],
): RespuestaCompuesta {
  if (servicios.length === 0) {
    return { resultado: 'SIN_DATOS', texto: `${ctx.barberia} todavía no publica servicios.` };
  }
  const lista = servicios.map((s) => `${s.nombre} — S/ ${s.precio} (${s.duracionMinutos} min)`).join('; ');
  return {
    resultado: 'RESPONDIDA',
    texto: `Estos son los servicios de ${ctx.barberia}: ${lista}.`,
    datos: { tipo: 'SERVICIOS', servicios },
  };
}

export function plantillaBarberos(
  ctx: ContextoDeLaRespuesta,
  servicio: { servicioId: string; nombre: string },
  barberos: BarberoDeLaRespuesta[],
): RespuestaCompuesta {
  if (barberos.length === 0) {
    return {
      resultado: 'SIN_DATOS',
      texto: `Por ahora nadie atiende ${servicio.nombre} en ${ctx.barberia}.`,
    };
  }
  return {
    resultado: 'RESPONDIDA',
    texto: `Para ${servicio.nombre} te pueden atender: ${enumerar(barberos.map((b) => b.nombre))}.`,
    datos: { tipo: 'BARBEROS', servicio, barberos },
  };
}

export function plantillaHorarios(
  ctx: ContextoDeLaRespuesta,
  consulta: {
    servicio: { servicioId: string; nombre: string };
    fecha: FechaLocal;
    horas: { inicio: string; barberos: BarberoDeLaRespuesta[] }[];
    barberoId?: string;
  },
): RespuestaCompuesta {
  const { servicio, fecha } = consulta;
  const cuando = fechaExacta(fecha);
  const horas: HoraDeLaRespuesta[] = consulta.horas.map((hora) => {
    const barbero = consulta.barberoId ?? hora.barberos[0]?.barberoId;
    return ctx.aceptaReservas && barbero
      ? {
          ...hora,
          enlace: enlaceAReservar(ctx.slug, { servicio: servicio.servicioId, barbero, inicio: hora.inicio }),
        }
      : { ...hora };
  });
  const datos: DatosDeLaRespuesta = { tipo: 'HORARIOS', servicio, fecha: fecha.toString(), horas };
  const sugerencia: Sugerencia | undefined = ctx.aceptaReservas
    ? { tipo: 'RESERVAR', enlace: enlaceAReservar(ctx.slug, { servicio: servicio.servicioId }) }
    : undefined;
  if (horas.length === 0) {
    return {
      resultado: 'RESPONDIDA',
      texto: `No hay horarios libres para ${servicio.nombre} el ${cuando}. Prueba otra fecha.`,
      datos,
      ...(sugerencia && { sugerencia }),
    };
  }
  const lista = enumerar(horas.map((h) => horaLocal(h.inicio)));
  const cierre = ctx.aceptaReservas
    ? '¿Quieres reservar?'
    : `Por ahora ${ctx.barberia} no acepta reservas en línea: consulta directamente con la barbería.`;
  return {
    resultado: 'RESPONDIDA',
    texto: `Para ${servicio.nombre} el ${cuando} hay horario a las ${lista}. ${cierre}`,
    datos,
    ...(sugerencia && { sugerencia }),
  };
}

export type MotivoSinDatos =
  | { tipo: 'sin_herramienta' }
  | { tipo: 'fecha_invalida'; valor: string }
  | { tipo: 'fecha_pasada'; fecha: FechaLocal }
  | { tipo: 'fuera_del_horizonte'; ultimo: FechaLocal }
  | { tipo: 'falta_fecha' }
  | { tipo: 'falta_servicio'; servicios: string[] }
  | { tipo: 'servicio_no_encontrado'; servicios: string[] }
  | { tipo: 'servicio_ambiguo'; opciones: string[] }
  | { tipo: 'barbero_no_encontrado'; barberos: string[] }
  | { tipo: 'barbero_ambiguo'; opciones: string[] };

export function plantillaSinDatos(ctx: ContextoDeLaRespuesta, motivo: MotivoSinDatos): RespuestaCompuesta {
  const sinDatos = (texto: string): RespuestaCompuesta => ({ resultado: 'SIN_DATOS', texto });
  switch (motivo.tipo) {
    case 'sin_herramienta':
      return {
        resultado: 'SIN_DATOS',
        texto: 'No tengo ese dato. Puedes consultarlo directamente con la barbería.',
        sugerencia: { tipo: 'CONTACTAR_BARBERIA' },
      };
    case 'fecha_invalida':
      return sinDatos(
        `"${motivo.valor}" no es una fecha válida. Dime el día que buscas, por ejemplo "mañana".`,
      );
    case 'fecha_pasada':
      return sinDatos(`El ${fechaExacta(motivo.fecha)} ya pasó. Dime una fecha desde hoy.`);
    case 'fuera_del_horizonte':
      return sinDatos(
        `Por ahora se puede reservar hasta el ${fechaExacta(motivo.ultimo)}. Elige una fecha anterior.`,
      );
    case 'falta_fecha':
      return sinDatos('¿Para qué día? Por ejemplo "mañana" o "el sábado".');
    case 'falta_servicio':
      return sinDatos(`¿Para qué servicio? En ${ctx.barberia} hay: ${enumerar(motivo.servicios)}.`);
    case 'servicio_no_encontrado':
      return sinDatos(
        motivo.servicios.length > 0
          ? `No encontré ese servicio. En ${ctx.barberia} hay: ${enumerar(motivo.servicios)}.`
          : `${ctx.barberia} todavía no publica servicios.`,
      );
    case 'servicio_ambiguo':
      return sinDatos(`¿Cuál de estos servicios quieres? ${enumerar(motivo.opciones, 'o')}.`);
    case 'barbero_no_encontrado':
      return sinDatos(
        motivo.barberos.length > 0
          ? `No encontré a ese barbero para el servicio. Te pueden atender: ${enumerar(motivo.barberos)}.`
          : 'Por ahora nadie atiende ese servicio.',
      );
    case 'barbero_ambiguo':
      return sinDatos(`¿Con cuál de ellos? ${enumerar(motivo.opciones, 'o')}.`);
  }
}

export function plantillaAccionNoPermitida(_ctx: ContextoDeLaRespuesta): RespuestaCompuesta {
  return {
    resultado: 'ACCION_NO_PERMITIDA',
    texto: 'No puedo reservar ni cambiar citas. Puedes hacerlo en Reservar o en Mis citas.',
    sugerencia: { tipo: 'MIS_CITAS' },
  };
}

export function plantillaFueraDeAlcance(
  ctx: ContextoDeLaRespuesta,
  rol: RolDelAsistente,
): RespuestaCompuesta {
  return {
    resultado: 'FUERA_DE_ALCANCE',
    texto:
      rol === 'CLIENTE'
        ? `Solo puedo ayudarte con los servicios, los barberos y los horarios de ${ctx.barberia}.`
        : 'Solo puedo ayudarte con el resumen de citas y los servicios más pedidos de tu barbería.',
  };
}
