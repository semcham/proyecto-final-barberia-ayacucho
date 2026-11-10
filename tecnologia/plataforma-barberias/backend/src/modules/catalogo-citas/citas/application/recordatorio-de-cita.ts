import { type BusDeEventos, ZonaHoraria } from '../../../../shared';
import type { Cita } from '../domain/cita';

// T089 de 004 · Recordatorio de la cita (research R09; FR-022, FR-023; contracts/eventos.md §3). Se programa en la
// MISMA transacción que la operación que lo origina, con la clave de reemplazo `recordatorio:<citaId>`:
// - al reservar o reprogramar, para `inicio − 2 h`, si faltan 2 h o más (si no, ninguno: se anula el anterior);
// - al cancelar, completar o marcar no asistió, se anula.
// M05 lo recibe cuando llega el momento (la tarea despachar-eventos solo despacha los eventos ya disponibles).

/** El recordatorio sale 2 h antes del inicio (fijo, aclaración del 2026-11-04). */
export const ANTELACION_RECORDATORIO_MS = 2 * 60 * 60 * 1000;

export const claveDelRecordatorio = (citaId: string) => `recordatorio:${citaId}`;

/** Programa (o reemplaza) el recordatorio de la cita; con menos de 2 h, anula el que hubiera. */
export async function programarRecordatorio(
  bus: BusDeEventos,
  cita: Cita,
  datos: { barbero: string; zonaHoraria: string; ahora: Date },
): Promise<void> {
  const momento = new Date(cita.rango.inicio.getTime() - ANTELACION_RECORDATORIO_MS);
  if (momento.getTime() < datos.ahora.getTime()) {
    await bus.anular(claveDelRecordatorio(cita.id));
    return;
  }
  const zona = new ZonaHoraria(datos.zonaHoraria);
  await bus.reemplazar(
    claveDelRecordatorio(cita.id),
    {
      tipo: 'RecordatorioDeCita',
      // Sin datos de contacto: M05 los lee de M01 al enviar.
      payload: {
        citaId: cita.id,
        version: cita.version,
        clienteId: cita.clienteId,
        servicio: cita.servicio.nombre,
        barbero: datos.barbero,
        inicio: zona.formatoIso(cita.rango.inicio),
        fin: zona.formatoIso(cita.rango.fin),
        zonaHoraria: datos.zonaHoraria,
      },
    },
    { disponibleDesde: momento },
  );
}

/** Anula el recordatorio pendiente de la cita, si hay uno. */
export async function anularRecordatorio(bus: BusDeEventos, citaId: string): Promise<void> {
  await bus.anular(claveDelRecordatorio(citaId));
}
