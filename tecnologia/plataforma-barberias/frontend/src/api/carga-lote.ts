import { ApiError, llamarApi } from './client';

/**
 * 011 (T028) · Carga en lote del catálogo (specs/011-carga-masiva-catalogo/contracts/openapi.yaml): revisar sin guardar
 * y guardar todo o nada. Los textos de cada problema son los de contracts/pantallas.md.
 */

export const MAX_FILAS_LOTE = 50;

export interface FilaServicioEnvio {
  nombre: string;
  duracionMinutos: number | null;
  precio: string;
  descripcion: string | null;
}

export interface ProblemaDeFila {
  /** Desde 1, en el orden enviado; null si el problema es de la carga entera. */
  fila: number | null;
  campo: string;
  problema: string;
}

export interface RevisionDeCarga {
  filas: number;
  errores: ProblemaDeFila[];
  advertencias: ProblemaDeFila[];
}

export interface ResumenCarga {
  tipo: 'SERVICIOS' | 'BARBEROS';
  creados: number;
  ids: string[];
}

export const revisarServicios = (filas: FilaServicioEnvio[]) =>
  llamarApi<RevisionDeCarga>('/servicios/lote/revision', { metodo: 'POST', cuerpo: { filas } });

export const cargarServicios = (filas: FilaServicioEnvio[], clave: string) =>
  llamarApi<ResumenCarga>('/servicios/lote', {
    metodo: 'POST',
    cuerpo: { filas },
    encabezados: { 'Idempotency-Key': clave },
  });

export interface FilaBarberoEnvio {
  nombre: string;
  servicioIds: string[];
}

export interface CupoDeBarberos {
  maximo: number;
  activos: number;
  disponibles: number;
}

export type RevisionDeBarberos = RevisionDeCarga & { cupo: CupoDeBarberos };

export const revisarBarberos = (filas: FilaBarberoEnvio[]) =>
  llamarApi<RevisionDeBarberos>('/barberos/lote/revision', { metodo: 'POST', cuerpo: { filas } });

export const cargarBarberos = (filas: FilaBarberoEnvio[], clave: string) =>
  llamarApi<ResumenCarga>('/barberos/lote', {
    metodo: 'POST',
    cuerpo: { filas },
    encabezados: { 'Idempotency-Key': clave },
  });

/** Datos del cupo de un 403 SUSCRIPCION_NO_PERMITE por LIMITE_BARBEROS al guardar, o null si el error es otro. */
export function cupoSuperado(
  error: unknown,
): { maximo: number; activos?: number; solicitados?: number } | null {
  if (!(error instanceof ApiError) || error.codigo !== 'SUSCRIPCION_NO_PERMITE') return null;
  const d = error.detalles.find((x) => x.motivo === 'LIMITE_BARBEROS');
  if (!d || typeof d.maximo !== 'number') return null;
  return {
    maximo: d.maximo,
    activos: typeof d.activos === 'number' ? d.activos : undefined,
    solicitados: typeof d.solicitados === 'number' ? d.solicitados : undefined,
  };
}

/** "Tu plan permite M barberos activos y ya tienes A. Quita X filas o cambia de plan." */
export function textoSuperaCupo(maximo: number, activos: number, filas: number): string {
  const quitar = Math.max(1, activos + filas - maximo);
  const cambio =
    activos >= maximo
      ? 'Desactiva a alguno o cambia de plan.'
      : `Quita ${quitar === 1 ? '1 fila' : `${quitar} filas`} o cambia de plan.`;
  return `Tu plan permite ${maximo} barberos activos y ya tienes ${activos}. ${cambio}`;
}

/** Los errores por fila de un 400 CARGA_INVALIDA, o null si el error es otro. */
export function erroresDeCarga(error: unknown): ProblemaDeFila[] | null {
  if (!(error instanceof ApiError) || error.codigo !== 'CARGA_INVALIDA') return null;
  return error.detalles.map((d) => ({
    fila: typeof d.fila === 'number' ? d.fila : null,
    campo: String(d.campo ?? ''),
    problema: String(d.problema ?? ''),
  }));
}

/** Texto corto, para mostrarlo debajo del campo en la tabla (el resumen usa `textoDelProblema`, más completo). */
export function textoCortoDelProblema(
  p: ProblemaDeFila,
  tipo: 'SERVICIOS' | 'BARBEROS' = 'SERVICIOS',
): string {
  switch (`${p.campo}:${p.problema}`) {
    case 'nombre:longitud':
      return 'Escribe de 2 a 80 letras.';
    case 'duracionMinutos:rango':
      return 'Entre 5 y 480 minutos.';
    case 'duracionMinutos:multiplo_de_5':
      return 'Usa minutos de 5 en 5.';
    case 'precio:falta':
      return 'Falta el precio.';
    case 'precio:formato':
      return 'Escribe un precio como 25 o 25.50.';
    case 'descripcion:longitud':
      return 'Máximo 300 letras.';
    case 'nombre:ya_existe':
      return tipo === 'SERVICIOS'
        ? 'Ya tienes un servicio con este nombre.'
        : 'Ya hay un barbero con este nombre.';
    case 'nombre:repetido_en_carga':
      return tipo === 'SERVICIOS' ? 'Este nombre ya está en otra fila.' : 'Otra fila tiene el mismo nombre.';
    case 'servicioIds:inactivo':
      return 'Un servicio elegido está desactivado.';
    case 'servicioIds:no_existe':
      return 'Un servicio elegido ya no existe.';
    default:
      return textoDelProblema(p, tipo);
  }
}

/** Texto simple de un problema: qué está mal y cómo corregirlo. */
export function textoDelProblema(p: ProblemaDeFila, tipo: 'SERVICIOS' | 'BARBEROS' = 'SERVICIOS'): string {
  switch (`${p.campo}:${p.problema}`) {
    case 'nombre:longitud':
      return 'Escribe un nombre de 2 a 80 letras.';
    case 'duracionMinutos:rango':
      return 'La duración debe estar entre 5 y 480 minutos.';
    case 'duracionMinutos:multiplo_de_5':
      return 'Usa minutos de 5 en 5 (por ejemplo 25, 30 o 45).';
    case 'precio:falta':
      return 'Falta el precio: escríbelo en soles (por ejemplo 25 o 25.50).';
    case 'precio:formato':
      return 'Escribe el precio en soles, con hasta dos decimales (por ejemplo 25 o 25.50).';
    case 'descripcion:longitud':
      return 'La descripción puede tener hasta 300 letras.';
    case 'nombre:repetido_en_carga':
      return tipo === 'SERVICIOS'
        ? 'Este nombre ya está en otra fila.'
        : 'Otro barbero de la lista se llama igual; revisa que no sea el mismo.';
    case 'nombre:ya_existe':
      return tipo === 'SERVICIOS'
        ? 'Ya tienes un servicio con este nombre (puede estar desactivado: reactívalo en Servicios).'
        : 'Ya hay un barbero llamado así; revisa que no sea el mismo.';
    case 'servicioIds:inactivo':
      return 'Uno de los servicios elegidos está desactivado.';
    case 'servicioIds:no_existe':
      return 'Uno de los servicios elegidos ya no existe.';
    case 'filas:vacia':
      return 'Escribe al menos una fila.';
    case 'filas:supera_cupo':
      return 'La carga supera los barberos activos que permite tu plan.';
    default:
      return 'Revisa este dato.';
  }
}
