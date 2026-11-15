import type { FechaLocal } from '../../../../shared/nucleo';

// T040 de 005 · La política de la cuota del asistente (FR-007, research R08): se cuenta por día LOCAL de la barbería y
// se reinicia a su medianoche. Los límites son fijos e iguales para todos los planes, de la configuración.

/** Lo que la regla necesita de la zona horaria de la barbería (ZonaHoraria de M06 lo cumple). */
export interface CalendarioDeLaBarberia {
  fechaDe(instante: Date): FechaLocal;
  finDelDia(fecha: FechaLocal): Date;
}

export interface MomentoDeCuota {
  /** El día local (YYYY-MM-DD) en que cuenta la pregunta. */
  dia: string;
  /** La próxima medianoche local. */
  reiniciaEn: Date;
  /** Los segundos hasta reiniciaEn, redondeados hacia arriba (Retry-After). */
  reintentarEnSegundos: number;
}

export function cuotaDelMomento(ahora: Date, calendario: CalendarioDeLaBarberia): MomentoDeCuota {
  const dia = calendario.fechaDe(ahora);
  const reiniciaEn = calendario.finDelDia(dia);
  return {
    dia: dia.toString(),
    reiniciaEn,
    reintentarEnSegundos: Math.max(1, Math.ceil((reiniciaEn.getTime() - ahora.getTime()) / 1000)),
  };
}

export interface LimitesDeCuota {
  usuario: number;
  barberia: number;
}

export function limitesDeCuota(configuracion: {
  cuotaUsuarioDia: number;
  cuotaBarberiaDia: number;
}): LimitesDeCuota {
  return { usuario: configuracion.cuotaUsuarioDia, barberia: configuracion.cuotaBarberiaDia };
}
