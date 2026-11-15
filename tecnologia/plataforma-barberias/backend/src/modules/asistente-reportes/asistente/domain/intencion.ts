import {
  HERRAMIENTAS_POR_ROL,
  INTENCIONES_DEL_CLIENTE,
  INTENCIONES_DEL_PROPIETARIO,
  type IntencionDeHerramienta,
  type RolDelAsistente,
} from './herramientas';

export type { IntencionDeHerramienta, RolDelAsistente } from './herramientas';

// T040 de 005 · El esquema CERRADO de intenciones (contracts/asistente.md §2, ADR-028). Lo que devuelve el modelo se
// valida aquí, en el backend: el modelo solo clasifica. Reglas:
// - una intención que no es del rol, o que no existe, es fuera_de_alcance; pedir reservar, cancelar o cambiar algo es
//   accion_no_permitida (FR-005);
// - los argumentos tienen una lista cerrada por intención: uno de más (barbería, tenant, cliente, id…) es
//   fuera_de_alcance (FR-004, FR-009); los textos tienen a lo sumo 80 caracteres y las fechas, la forma YYYY-MM-DD;
// - un argumento obligatorio que falta no es un ataque: se pide después (SIN_DATOS), sin inventar nada.

export type IntencionValidada =
  | { tipo: 'servicios' }
  | { tipo: 'barberos'; servicio?: string }
  | { tipo: 'horarios_libres'; servicio?: string; fecha?: string; barbero?: string }
  | { tipo: 'resumen_citas'; desde?: string; hasta?: string }
  | { tipo: 'servicios_mas_pedidos'; desde?: string; hasta?: string }
  | { tipo: 'fuera_de_alcance' }
  | { tipo: 'accion_no_permitida' };

type TipoDeArgumento = 'texto' | 'fecha';

/** Argumentos admitidos por intención (additionalProperties: false). */
const ESQUEMA: Record<IntencionDeHerramienta, Record<string, TipoDeArgumento>> = {
  servicios: {},
  barberos: { servicio: 'texto' },
  horarios_libres: { servicio: 'texto', fecha: 'fecha', barbero: 'texto' },
  resumen_citas: { desde: 'fecha', hasta: 'fecha' },
  servicios_mas_pedidos: { desde: 'fecha', hasta: 'fecha' },
};

export const LARGO_MAXIMO_ARGUMENTO = 80;
const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Nombres de intención que piden actuar sobre una cita: nunca se ejecutan (FR-005). */
const PIDE_UNA_ACCION = /(reserv|cancel|reprogram|cambi|anul|agend|modific|borr|elimin|confirm)/i;

const FUERA: IntencionValidada = { tipo: 'fuera_de_alcance' };

function argumentosValidos(
  intencion: IntencionDeHerramienta,
  argumentos: Readonly<Record<string, unknown>>,
): Record<string, string> | null {
  const esquema = ESQUEMA[intencion];
  const validos: Record<string, string> = {};
  for (const [nombre, valor] of Object.entries(argumentos)) {
    const tipo = esquema[nombre];
    if (!tipo || typeof valor !== 'string') return null;
    const limpio = valor.trim();
    if (limpio.length > LARGO_MAXIMO_ARGUMENTO) return null;
    if (tipo === 'fecha' && !FORMATO_FECHA.test(limpio)) return null;
    if (limpio !== '') validos[nombre] = limpio;
  }
  return validos;
}

/** Valida la intención del modelo contra el esquema cerrado y las herramientas del rol. */
export function validarIntencion(
  rol: RolDelAsistente,
  bruta: { intencion: string; argumentos: Readonly<Record<string, unknown>> },
): IntencionValidada {
  const nombre = bruta.intencion.trim();
  if (nombre === 'fuera_de_alcance') return FUERA;
  if (nombre === 'accion_no_permitida') return { tipo: 'accion_no_permitida' };
  const delRol = HERRAMIENTAS_POR_ROL[rol] as readonly string[];
  if (!delRol.includes(nombre)) {
    const deOtroRol = [...INTENCIONES_DEL_CLIENTE, ...INTENCIONES_DEL_PROPIETARIO] as readonly string[];
    return !deOtroRol.includes(nombre) && PIDE_UNA_ACCION.test(nombre)
      ? { tipo: 'accion_no_permitida' }
      : FUERA;
  }
  const intencion = nombre as IntencionDeHerramienta;
  const argumentos = argumentosValidos(intencion, bruta.argumentos);
  if (!argumentos) return FUERA;
  return { tipo: intencion, ...argumentos } as IntencionValidada;
}
