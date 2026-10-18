import { HorarioSemanal, type ZonaHoraria } from '../../../../shared';
import type { Actor } from '../../../acceso-barberias';
import type { Barbero } from '../domain/barbero';
import type { Bloqueo } from '../domain/bloqueo';
import { AccesoDenegado, type CitaAfectada, ConflictoConCitas, NoEncontrado } from '../domain/errores';
import type { Alcance } from '../domain/permisos';
import type { Servicio } from '../domain/servicio';
import type { BarberoRepository, CitaActiva } from './ports/catalogo-repositorios';

// Piezas comunes de los casos de uso del catálogo (US1): vistas del contrato de 002 y conflictos con citas.

const MINUTO_MS = 60 * 1000;

/** Tramo como lo recibe y devuelve la API (esquema TramoHorario). */
export interface TramoVista {
  diaSemana: number;
  inicio: string;
  fin: string;
}

export interface HorarioVista {
  tramos: TramoVista[];
}

export function horarioDesde(tramos: readonly TramoVista[]): HorarioSemanal {
  return HorarioSemanal.crear(
    tramos.map((t) => ({
      diaSemana: t.diaSemana,
      inicioMin: HorarioSemanal.minutosDe(t.inicio),
      finMin: HorarioSemanal.minutosDe(t.fin),
    })),
  );
}

export function aHorarioVista(horario: HorarioSemanal): HorarioVista {
  return {
    tramos: horario.todos().map((t) => ({
      diaSemana: t.diaSemana,
      inicio: HorarioSemanal.horaDe(t.inicioMin),
      fin: HorarioSemanal.horaDe(t.finMin),
    })),
  };
}

export interface ServicioVista {
  id: string;
  nombre: string;
  descripcion: string | null;
  precio: string;
  duracionMinutos: number;
  activo: boolean;
}

export function aServicioVista(s: Servicio): ServicioVista {
  return {
    id: s.id,
    nombre: s.nombre,
    descripcion: s.descripcion,
    precio: s.precio,
    duracionMinutos: s.duracionMin,
    activo: s.activo,
  };
}

export interface BarberoVista {
  id: string;
  nombre: string;
  activo: boolean;
  servicioIds: string[];
  usuarioId: string | null;
}

export function aBarberoVista(b: Barbero): BarberoVista {
  return { id: b.id, nombre: b.nombre, activo: b.activo, servicioIds: b.servicioIds, usuarioId: b.usuarioId };
}

export interface BloqueoVista {
  id: string;
  barberoId: string;
  inicio: string;
  fin: string;
  motivo: string | null;
}

export function aBloqueoVista(b: Bloqueo, zona: ZonaHoraria): BloqueoVista {
  return {
    id: b.id,
    barberoId: b.barberoId,
    inicio: zona.formatoIso(b.inicio),
    fin: zona.formatoIso(b.fin),
    motivo: b.motivo,
  };
}

/** Citas activas que quedarían fuera del horario semanal dado (en la hora local de la barbería). */
export function fueraDelHorario(
  citas: readonly CitaActiva[],
  horario: HorarioSemanal,
  zona: ZonaHoraria,
): CitaActiva[] {
  return citas.filter((cita) => {
    const local = zona.aLocal(cita.inicio);
    const finMin = local.minutos + Math.ceil((cita.fin.getTime() - cita.inicio.getTime()) / MINUTO_MS);
    return !horario
      .tramosDe(local.fecha.diaSemana)
      .some((t) => t.inicioMin <= local.minutos && finMin <= t.finMin);
  });
}

/**
 * Confirmación en dos pasos (R11): si hay citas afectadas y no llegó `confirmarConflictos`, responde 409
 * `CONFLICTO_CON_CITAS` con la lista (sin datos del cliente) y no se guarda nada.
 */
export function exigirConfirmacion(
  citas: readonly CitaActiva[],
  confirmado: boolean | undefined,
  zona: ZonaHoraria,
): void {
  if (citas.length === 0 || confirmado === true) return;
  const afectadas: CitaAfectada[] = citas.map((c) => ({
    id: c.id,
    inicio: zona.formatoIso(c.inicio),
    barberoId: c.barberoId,
    servicio: c.servicio,
  }));
  throw new ConflictoConCitas(afectadas);
}

/**
 * El barbero sobre el que opera el actor: 404 si no existe en la barbería; con alcance PROPIOS (rol
 * BARBERO), 403 si no es el barbero vinculado a su usuario.
 */
export async function barberoAccesible(
  barberos: BarberoRepository,
  actor: Actor,
  alcance: Alcance,
  barberoId: string,
): Promise<Barbero> {
  const barbero = await barberos.porId(barberoId);
  if (!barbero) throw new NoEncontrado();
  if (alcance === 'PROPIOS' && barbero.usuarioId !== actor.usuarioId) throw new AccesoDenegado();
  return barbero;
}
