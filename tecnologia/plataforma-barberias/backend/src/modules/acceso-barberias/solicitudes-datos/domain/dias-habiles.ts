import type { FechaLocal } from '../../../../shared/nucleo';

const SABADO = 6;
const DOMINGO = 0;

/**
 * T009 de 007 · Plazo interno de las solicitudes (FR-004): `dias` días hábiles (lunes a viernes) contados desde el día
 * siguiente a `desde`. No cuenta feriados: el plazo está por validar contra el plazo legal (spec, Asunciones).
 */
export function sumarDiasHabiles(desde: FechaLocal, dias: number): FechaLocal {
  let fecha = desde;
  let contados = 0;
  while (contados < dias) {
    fecha = fecha.sumarDias(1);
    if (fecha.diaSemana !== SABADO && fecha.diaSemana !== DOMINGO) contados += 1;
  }
  return fecha;
}
