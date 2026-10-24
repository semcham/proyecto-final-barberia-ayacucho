import type { CatalogoPublicoDatos } from './ports/catalogo-publico-query';

/**
 * T036 (006) · Entrada del catálogo público en la caché compartida (data-model.md §2.1). Formato `v: 1` con
 * lista cerrada de campos: se copian solo las columnas públicas, nunca el objeto recibido, para que un campo
 * de más (un dato privado) no llegue a Redis (FR-013). Lo que no tenga este formato equivale a ausente
 * (FR-015) y se vuelve a leer de PostgreSQL.
 */

export const VERSION_ENTRADA_CATALOGO = 1;

export interface EntradaCatalogo extends CatalogoPublicoDatos {
  v: typeof VERSION_ENTRADA_CATALOGO;
  /** Generación con la que se guardó (R08). */
  generacion: number;
}

function copiar(datos: CatalogoPublicoDatos): CatalogoPublicoDatos {
  return {
    horario: {
      tramos: datos.horario.tramos.map((t) => ({ diaSemana: t.diaSemana, inicio: t.inicio, fin: t.fin })),
    },
    servicios: datos.servicios.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      descripcion: s.descripcion,
      precio: s.precio,
      duracionMinutos: s.duracionMinutos,
    })),
    barberos: datos.barberos.map((b) => ({ id: b.id, nombre: b.nombre, servicioIds: [...b.servicioIds] })),
  };
}

export function crearEntradaCatalogo(datos: CatalogoPublicoDatos, generacion: number): EntradaCatalogo {
  return { v: VERSION_ENTRADA_CATALOGO, generacion, ...copiar(datos) };
}

const esObjeto = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const esTexto = (x: unknown): x is string => typeof x === 'string';
const esEntero = (x: unknown): x is number => Number.isInteger(x);
const listaDe = <T>(x: unknown, valido: (y: unknown) => y is T): x is T[] =>
  Array.isArray(x) && x.every(valido);

const esTramo = (t: unknown): t is CatalogoPublicoDatos['horario']['tramos'][number] =>
  esObjeto(t) && esEntero(t.diaSemana) && esTexto(t.inicio) && esTexto(t.fin);

const esServicio = (s: unknown): s is CatalogoPublicoDatos['servicios'][number] =>
  esObjeto(s) &&
  esTexto(s.id) &&
  esTexto(s.nombre) &&
  (s.descripcion === null || esTexto(s.descripcion)) &&
  esTexto(s.precio) &&
  esEntero(s.duracionMinutos);

const esBarbero = (b: unknown): b is CatalogoPublicoDatos['barberos'][number] =>
  esObjeto(b) && esTexto(b.id) && esTexto(b.nombre) && listaDe(b.servicioIds, esTexto);

/** Entrada válida (copiada con la lista cerrada de campos), o `null` si no tiene el formato `v: 1`. */
export function leerEntradaCatalogo(valor: unknown): EntradaCatalogo | null {
  if (!esObjeto(valor) || valor.v !== VERSION_ENTRADA_CATALOGO) return null;
  if (!esEntero(valor.generacion) || valor.generacion < 0) return null;
  const { horario, servicios, barberos } = valor;
  if (!esObjeto(horario) || !listaDe(horario.tramos, esTramo)) return null;
  if (!listaDe(servicios, esServicio) || !listaDe(barberos, esBarbero)) return null;
  return crearEntradaCatalogo({ horario: { tramos: horario.tramos }, servicios, barberos }, valor.generacion);
}

/** Datos del catálogo sin la versión ni la generación (lo que va en la respuesta). */
export function datosDeEntrada(entrada: EntradaCatalogo): CatalogoPublicoDatos {
  const { horario, servicios, barberos } = entrada;
  return { horario, servicios, barberos };
}
