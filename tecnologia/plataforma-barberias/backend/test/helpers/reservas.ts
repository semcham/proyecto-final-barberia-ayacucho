import { randomUUID } from 'node:crypto';
import { ZonaHoraria } from '../../src/shared/tiempo/zona-horaria';
import {
  sembrarBarberia,
  sembrarBarbero,
  sembrarDisponibilidad,
  sembrarHorarioAtencion,
  sembrarServicio,
  type BarberiaSembrada,
  type TramoSembrado,
} from './fixtures';
import { poolDe } from './test-db';

// Ayudantes de las pruebas de reserva (US3 de 002): barbería lista para reservar y fechas en hora de Lima.

const DIA_MS = 24 * 60 * 60 * 1000;

/** Todos los días de la semana, de 09:00 a 19:00: cualquier fecha futura sirve para reservar. */
export const SEMANA_COMPLETA: readonly TramoSembrado[] = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
  dia,
  inicio: '09:00',
  fin: '19:00',
}));

/** Fecha local de Lima (YYYY-MM-DD) dentro de `dias` días. */
export function fechaEnDias(dias: number): string {
  return ZonaHoraria.LIMA.fechaDe(new Date(Date.now() + dias * DIA_MS)).toString();
}

/** Instante ISO con desplazamiento de Lima, como lo envía la interfaz: `2026-10-21T10:00:00-05:00`. */
export function horaLima(fecha: string, hora: string): string {
  return `${fecha}T${hora}:00-05:00`;
}

export interface BarberiaParaReservar {
  barberia: BarberiaSembrada;
  servicioId: string;
  barberoId: string;
  /** Un segundo barbero que también ofrece el servicio. */
  otroBarberoId: string;
}

/** Barbería activa con suscripción, horario de atención, un servicio de 30 min y dos barberos disponibles. */
export async function barberiaParaReservar(): Promise<BarberiaParaReservar> {
  // sembrarBarberia ya deja la suscripción de prueba vigente (T059 de 003).
  const barberia = await sembrarBarberia();
  await sembrarHorarioAtencion(barberia.tenantId, SEMANA_COMPLETA);
  const { servicioId } = await sembrarServicio({
    tenantId: barberia.tenantId,
    nombre: 'Corte',
    precio: '20.00',
    duracionMin: 30,
  });
  const { barberoId } = await sembrarBarbero({
    tenantId: barberia.tenantId,
    nombre: 'Luis',
    servicios: [servicioId],
  });
  const { barberoId: otroBarberoId } = await sembrarBarbero({
    tenantId: barberia.tenantId,
    nombre: 'Ana',
    servicios: [servicioId],
  });
  await sembrarDisponibilidad(barberia.tenantId, barberoId, SEMANA_COMPLETA);
  await sembrarDisponibilidad(barberia.tenantId, otroBarberoId, SEMANA_COMPLETA);
  return { barberia, servicioId, barberoId, otroBarberoId };
}

export const nuevaClave = (): string => randomUUID();

/** Citas activas (PENDIENTE o CONFIRMADA) de un barbero que se solapan con [inicio, fin), sin RLS. */
export async function citasActivasEn(barberoId: string, inicio: string, fin: string): Promise<number> {
  const { rows } = await poolDe('seed').query<{ total: number }>(
    `SELECT count(*)::int AS total FROM appointment
     WHERE barber_id = $1 AND status IN ('PENDIENTE', 'CONFIRMADA')
       AND period && tstzrange($2::timestamptz, $3::timestamptz, '[)')`,
    [barberoId, inicio, fin],
  );
  return rows[0].total;
}
