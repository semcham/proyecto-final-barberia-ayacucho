// Funcionalidad 009 (research R04): fechas de las citas y reglas de idempotencia de la semilla.

/** Fecha local (AAAA-MM-DD) de un instante en la zona horaria dada. */
export function fechaLocal(instante, zonaHoraria) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instante);
}

/** Hora local HH:MM de un instante ISO en la zona horaria dada. */
export function horaLocal(iso, zonaHoraria) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zonaHoraria,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** Desfase de la zona horaria en una fecha, como "-05:00". */
export function desfase(fecha, zonaHoraria) {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    timeZoneName: 'longOffset',
  }).formatToParts(new Date(`${fecha}T12:00:00Z`));
  const nombre = partes.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  return nombre === 'GMT' ? '+00:00' : nombre.replace('GMT', '');
}

/**
 * El n-ésimo día de atención (1 = el primero) después de `hoy`, según los días de la semana del horario.
 * Así la semilla siempre reserva en un día abierto y en el futuro, sin fechas fijas.
 */
export function diaDeAtencion(n, hoy, horario, zonaHoraria) {
  const abiertos = new Set(horario.map((t) => t.diaSemana));
  const [a, m, d] = fechaLocal(hoy, zonaHoraria).split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d));
  let encontrados = 0;
  for (let i = 0; i < 400; i++) {
    fecha.setUTCDate(fecha.getUTCDate() + 1);
    if (abiertos.has(fecha.getUTCDay()) && ++encontrados === n) return fecha.toISOString().slice(0, 10);
  }
  throw new Error('El horario no tiene días de atención.');
}

/** Inicio ISO con desfase, por ejemplo 2026-11-20T09:00:00-05:00. */
export function inicioIso(fecha, hora, zonaHoraria) {
  return `${fecha}T${hora}:00${desfase(fecha, zonaHoraria)}`;
}

/**
 * Una cita de la semilla ya existe si el cliente tiene una con el mismo barbero, el mismo servicio y la misma hora
 * local, en cualquier fecha y estado. Así la semilla es idempotente también si se vuelve a cargar otro día.
 */
export function buscarCitaExistente(citasDelCliente, entrada, zonaHoraria) {
  return citasDelCliente.find(
    (c) =>
      c.barbero === entrada.barbero &&
      c.servicio === entrada.servicio &&
      horaLocal(c.inicio, zonaHoraria) === entrada.hora,
  );
}

/** Igualdad de horarios semanales sin importar el orden de los tramos. */
export function mismosTramos(a = [], b = []) {
  const clave = (t) => `${t.diaSemana}|${t.inicio}|${t.fin}`;
  const x = [...a].map(clave).sort();
  const y = [...b].map(clave).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}
