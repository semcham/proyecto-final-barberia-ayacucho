import {
  AIProvider,
  type Interpretacion,
  leerInterpretacion,
  ProveedorIANoDisponible,
  type SolicitudDeInterpretacion,
} from '../application/ports/ai-provider';

// T011 de 005 · Proveedor falso (contracts/asistente.md §6, ADR-027): determinista y sin red; es el de las pruebas y
// la CI. En modo normal clasifica por palabras clave en español, como lo haría un modelo correcto, con la fecha y la
// zona que recibe. Los modos de prueba los fija cada prueba (fijarModo); el modo de demostración de Docker Compose
// sale de IA_FALSO_MODO al crearse. No hay ruta HTTP ni archivo para cambiarlo. Registra cada solicitud recibida
// para las pruebas de privacidad (PR19: lo que recibió no contiene el catálogo ni datos de clientes).

export type ModoFalso =
  | { tipo: 'normal' }
  /** Devuelve tal cual lo que diría un modelo engañado (PR19, modo "guion"). */
  | { tipo: 'guion'; respuesta: unknown }
  /** Conexión rechazada: falla al instante. */
  | { tipo: 'caido' }
  /** Tarda `ms` antes de clasificar; si la señal vence antes, TIEMPO_AGOTADO. */
  | { tipo: 'lento'; ms: number }
  /** 429 o 5xx del proveedor; con `veces`, falla esas veces y después vuelve a normal. */
  | { tipo: 'error'; estado: 429 | 500 | 502 | 503; veces?: number }
  /** JSON roto. */
  | { tipo: 'invalido' };

export type ModoDeDemostracion = 'normal' | 'caido' | 'lento';

const GENERICAS = ['fuera_de_alcance', 'accion_no_permitida'];

export class ProveedorIAFalso extends AIProvider {
  /** Más que el tiempo límite máximo permitido (2800 ms): en la demostración siempre se agota. */
  static readonly LENTO_DEMOSTRACION_MS = 10_000;

  private readonly modoInicial: ModoFalso;
  private modo: ModoFalso;
  private readonly registro: SolicitudDeInterpretacion[] = [];

  constructor(demostracion: ModoDeDemostracion = 'normal') {
    super();
    this.modoInicial =
      demostracion === 'caido'
        ? { tipo: 'caido' }
        : demostracion === 'lento'
          ? { tipo: 'lento', ms: ProveedorIAFalso.LENTO_DEMOSTRACION_MS }
          : { tipo: 'normal' };
    this.modo = this.modoInicial;
  }

  /** Copias de las solicitudes recibidas, en orden (también las que fallaron). */
  get llamadas(): readonly SolicitudDeInterpretacion[] {
    return this.registro;
  }

  fijarModo(modo: ModoFalso): void {
    this.modo = modo;
  }

  /** Vuelve al modo con el que se creó. */
  restaurar(): void {
    this.modo = this.modoInicial;
  }

  limpiarLlamadas(): void {
    this.registro.length = 0;
  }

  async interpretar(solicitud: SolicitudDeInterpretacion, senal: AbortSignal): Promise<Interpretacion> {
    this.registro.push(structuredClone({ ...solicitud, contexto: [...solicitud.contexto] }));
    if (senal.aborted) throw new ProveedorIANoDisponible('TIEMPO_AGOTADO');
    const modo = this.modo;
    switch (modo.tipo) {
      case 'caido':
        throw new ProveedorIANoDisponible('ERROR');
      case 'error':
        if (modo.veces !== undefined) {
          if (modo.veces <= 1) this.modo = { tipo: 'normal' };
          else this.modo = { ...modo, veces: modo.veces - 1 };
        }
        throw new ProveedorIANoDisponible('ERROR', modo.estado);
      case 'invalido':
        throw new ProveedorIANoDisponible('RESPUESTA_INVALIDA');
      case 'guion':
        return leerInterpretacion(modo.respuesta);
      case 'lento':
        await esperar(modo.ms, senal);
        return clasificar(solicitud);
      case 'normal':
        return clasificar(solicitud);
    }
  }
}

/** Espera `ms` o, si la señal se aborta antes, lanza TIEMPO_AGOTADO sin dejar temporizadores vivos. */
function esperar(ms: number, senal: AbortSignal): Promise<void> {
  return new Promise((resolver, rechazar) => {
    const alAbortar = () => {
      clearTimeout(temporizador);
      rechazar(new ProveedorIANoDisponible('TIEMPO_AGOTADO'));
    };
    const temporizador = setTimeout(() => {
      senal.removeEventListener('abort', alAbortar);
      resolver();
    }, ms);
    senal.addEventListener('abort', alAbortar, { once: true });
  });
}

// --- Clasificación por palabras clave (modo normal) ---

/** Minúsculas y sin tildes, para comparar palabras. */
function normalizar(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const ACCION =
  /\b(reserva(me|r|rme)?|agenda(me|r|rme)?|cancela(me|r)?|reprograma(me|r)?|anula(me|r)?|cambia(me|r)? (mi|la) cita)\b/;
const MAS_PEDIDOS = /\b(mas (pedid|solicitad|popular|vendid)\w*|piden mas|solicitan mas)\b/;
const RESUMEN = /\b(cuantas (citas|reservas)|citas tuve|resumen)\b/;
const HORARIOS = /\b(horarios?|hora|disponib\w*|libres?|turnos?|cupos?)\b/;
const BARBEROS = /\b(barberos?|quien(es)? (me )?(atiende|atienden|corta|cortan))\b/;
const SERVICIOS = /\b(servicios?|precios?|cuesta|cuestan|cuanto|tarifas?|ofrecen)\b/;

const DIAS_SEMANA: Record<string, number> = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
};

/** Palabras que cortan el nombre de un servicio o de un barbero. */
const CORTE_DE_FRASE =
  '(?=\\s+(con|el|la|para|este|esta|hoy|manana|pasado|lunes|martes|miercoles|jueves|viernes|sabado|domingo|a las|de|del|\\d{4}-)\\b|[?.!,;:]|$)';
/** Artículo opcional antes del nombre; de más largo a más corto, para que "una" no quede como "un" + "a". */
const ARTICULO = '(?:(?:unas|unos|una|un|las|los|el|la)\\s+)?';
const SERVICIO_TRAS_PARA = new RegExp(`\\bpara ${ARTICULO}([a-z0-9][a-z0-9 ]*?)${CORTE_DE_FRASE}`);
const SERVICIO_TRAS_ATIENDE = new RegExp(
  `\\b(?:atiende|atienden|hacen|corta|cortan)\\s+${ARTICULO}([a-z0-9][a-z0-9 ]*?)${CORTE_DE_FRASE}`,
);
const BARBERO_TRAS_CON = new RegExp(`\\bcon ([a-z]+(?: [a-z]+)?)${CORTE_DE_FRASE}`);

function clasificar(solicitud: SolicitudDeInterpretacion): Interpretacion {
  const texto = normalizar(solicitud.pregunta);
  const { intencion, argumentos } = candidata(texto, solicitud.hoy);
  const permitida = [...solicitud.intencionesPermitidas, ...GENERICAS].includes(intencion);
  // Un modelo correcto no usa una intención que el rol no tiene: la pregunta queda fuera de su alcance.
  return leerInterpretacion(permitida ? { intencion, argumentos } : { intencion: 'fuera_de_alcance' });
}

function candidata(texto: string, hoy: string): { intencion: string; argumentos: Record<string, string> } {
  if (ACCION.test(texto)) return { intencion: 'accion_no_permitida', argumentos: {} };
  if (MAS_PEDIDOS.test(texto)) return { intencion: 'servicios_mas_pedidos', argumentos: periodo(texto, hoy) };
  if (RESUMEN.test(texto)) return { intencion: 'resumen_citas', argumentos: periodo(texto, hoy) };
  if (HORARIOS.test(texto)) {
    const argumentos: Record<string, string> = {};
    const servicio = SERVICIO_TRAS_PARA.exec(texto)?.[1]?.trim();
    if (servicio) argumentos.servicio = servicio;
    argumentos.fecha = fecha(texto, hoy);
    const barbero = BARBERO_TRAS_CON.exec(texto)?.[1]?.trim();
    if (barbero) argumentos.barbero = barbero;
    return { intencion: 'horarios_libres', argumentos };
  }
  if (BARBEROS.test(texto)) {
    const servicio = (SERVICIO_TRAS_ATIENDE.exec(texto) ?? SERVICIO_TRAS_PARA.exec(texto))?.[1]?.trim();
    return { intencion: 'barberos', argumentos: servicio ? { servicio } : {} };
  }
  if (SERVICIOS.test(texto)) return { intencion: 'servicios', argumentos: {} };
  return { intencion: 'fuera_de_alcance', argumentos: {} };
}

// --- Fechas relativas, con la fecha de hoy de la barbería (YYYY-MM-DD) ---

const DIA_MS = 24 * 60 * 60 * 1000;

function aDia(fechaLocal: string): number {
  const [anio, mes, dia] = fechaLocal.split('-').map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

function deDia(instante: number): string {
  return new Date(instante).toISOString().slice(0, 10);
}

const sumarDias = (fechaLocal: string, dias: number) => deDia(aDia(fechaLocal) + dias * DIA_MS);

/** Día de la semana (0 = domingo). */
const diaDeLaSemana = (fechaLocal: string) => new Date(aDia(fechaLocal)).getUTCDay();

function fecha(texto: string, hoy: string): string {
  const explicita = /\b(\d{4}-\d{2}-\d{2})\b/.exec(texto)?.[1];
  if (explicita) return explicita;
  if (/\bpasado manana\b/.test(texto)) return sumarDias(hoy, 2);
  if (/\bmanana\b/.test(texto)) return sumarDias(hoy, 1);
  for (const [nombre, numero] of Object.entries(DIAS_SEMANA)) {
    if (new RegExp(`\\b${nombre}\\b`).test(texto)) {
      return sumarDias(hoy, (numero - diaDeLaSemana(hoy) + 7) % 7);
    }
  }
  return hoy;
}

/** Período de un reporte: desde y hasta, incluidos, como YYYY-MM-DD. */
function periodo(texto: string, hoy: string): { desde: string; hasta: string } {
  const fechas = texto.match(/\b\d{4}-\d{2}-\d{2}\b/g);
  if (fechas && fechas.length >= 2) return { desde: fechas[0], hasta: fechas[1] };
  const [anio, mes] = hoy.split('-').map(Number);
  const inicioDeMes = (a: number, m: number) => deDia(Date.UTC(a, m - 1, 1));
  if (/\bmes pasado\b/.test(texto)) {
    const desde = inicioDeMes(mes === 1 ? anio - 1 : anio, mes === 1 ? 12 : mes - 1);
    return { desde, hasta: sumarDias(inicioDeMes(anio, mes), -1) };
  }
  // Semana de lunes a domingo.
  const lunes = sumarDias(hoy, -((diaDeLaSemana(hoy) + 6) % 7));
  if (/\bsemana pasada\b/.test(texto)) return { desde: sumarDias(lunes, -7), hasta: sumarDias(lunes, -1) };
  if (/\besta semana\b/.test(texto)) return { desde: lunes, hasta: hoy };
  if (/\bayer\b/.test(texto)) return { desde: sumarDias(hoy, -1), hasta: sumarDias(hoy, -1) };
  if (/\bhoy\b/.test(texto)) return { desde: hoy, hasta: hoy };
  return { desde: inicioDeMes(anio, mes), hasta: hoy };
}
