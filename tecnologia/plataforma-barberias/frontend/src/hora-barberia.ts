/**
 * Horas en la zona de la barbería (research R07 de 002, T039). Se formatea siempre con la zona que devuelve
 * la API (`zonaHoraria`, hoy America/Lima) y nunca con la del dispositivo: así un cliente con el celular en
 * otra zona ve y reserva exactamente la hora de la barbería.
 */

export const ETIQUETA_HORA_BARBERIA = 'hora de la barbería';

const formatos = new Map<string, Intl.DateTimeFormat>();

function formato(zona: string, opciones: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const clave = `${zona}|${JSON.stringify(opciones)}`;
  let existente = formatos.get(clave);
  if (!existente) {
    existente = new Intl.DateTimeFormat('es-PE', { timeZone: zona, ...opciones });
    formatos.set(clave, existente);
  }
  return existente;
}

function aFecha(instante: string | Date): Date {
  return instante instanceof Date ? instante : new Date(instante);
}

/** "10:00" en la hora de la barbería (24 h). */
export function horaDeBarberia(instante: string | Date, zona: string): string {
  return formato(zona, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(aFecha(instante));
}

/** "martes 20 de octubre" en la fecha de la barbería. */
export function fechaDeBarberia(instante: string | Date, zona: string): string {
  return formato(zona, { weekday: 'long', day: 'numeric', month: 'long' }).format(aFecha(instante));
}

/** "10:00 (hora de la barbería)": para mostrar junto a horarios y citas. */
export function horaConEtiqueta(instante: string | Date, zona: string): string {
  return `${horaDeBarberia(instante, zona)} (${ETIQUETA_HORA_BARBERIA})`;
}
