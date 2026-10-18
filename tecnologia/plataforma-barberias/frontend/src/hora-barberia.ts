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

/** "2026-10-20": fecha local de la barbería, en el formato de los parámetros `fecha` de la API. */
export function fechaIsoDeBarberia(instante: string | Date, zona: string): string {
  const partes = formato(zona, { year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    aFecha(instante),
  );
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

/**
 * Instante ISO con el desplazamiento de la zona para una fecha y hora locales de la barbería:
 * ("2026-10-20", "10:00", "America/Lima") → "2026-10-20T10:00:00-05:00". No usa la zona del dispositivo.
 */
export function isoEnZona(fecha: string, hora: string, zona: string): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const [hh, mm] = hora.split(':').map(Number);
  const comoUtc = Date.UTC(anio, mes - 1, dia, hh, mm);
  // Desplazamiento de la zona en ese momento: hora local que muestra la zona menos la hora UTC.
  const partes = formato(zona, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(comoUtc));
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => Number(partes.find((p) => p.type === tipo)?.value);
  const localComoUtc = Date.UTC(
    valor('year'),
    valor('month') - 1,
    valor('day'),
    valor('hour'),
    valor('minute'),
  );
  const minutos = Math.round((localComoUtc - comoUtc) / 60_000);
  const signo = minutos < 0 ? '-' : '+';
  const abs = Math.abs(minutos);
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${fecha}T${hora}:00${signo}${dos(Math.floor(abs / 60))}:${dos(abs % 60)}`;
}

/** Suma días a una fecha "YYYY-MM-DD" (calendario puro, sin zonas). */
export function sumarDiasIso(fecha: string, dias: number): string {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

/** "10:00 (hora de la barbería)": para mostrar junto a horarios y citas. */
export function horaConEtiqueta(instante: string | Date, zona: string): string {
  return `${horaDeBarberia(instante, zona)} (${ETIQUETA_HORA_BARBERIA})`;
}
