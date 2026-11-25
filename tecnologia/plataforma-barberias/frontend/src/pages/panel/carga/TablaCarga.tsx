import type { CSSProperties, ReactNode } from 'react';
import { Icono } from '../../../components/Icono';
import { BotonIcono } from '../../../components/ui';
import estilos from './TablaCarga.module.css';

/**
 * 011 (T029) · Tabla editable de una carga en lote (contracts/pantallas.md). A 360 px cada fila es una ficha con sus
 * campos etiquetados; desde 48rem, una tabla con encabezados de columna. Cada campo tiene su propia etiqueta (visible en
 * el celular, solo para lectores de pantalla en la tabla) y, si la revisión lo marcó, su error o su advertencia enlazado
 * por aria-describedby.
 */

export interface ColumnaCarga<F> {
  campo: keyof F & string;
  /** Nombre de la columna (y etiqueta del campo). */
  etiqueta: string;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal';
  /** Ancho relativo en la tabla de escritorio (fr). */
  ancho?: number;
  /** Prefijo visual dentro del campo (por ejemplo "S/"). */
  prefijo?: string;
  sufijo?: string;
  /** Campo propio (casillas, etc.) en lugar de un texto. */
  renderizar?: (
    fila: F,
    indice: number,
    ids: { id: string; idEtiqueta: string; descrito?: string; invalido: boolean },
  ) => ReactNode;
}

export interface MarcaDeCampo {
  tono: 'error' | 'aviso';
  texto: string;
}

/** id del control de un campo de una fila (para llevar el foco desde el resumen). */
export const idDeCampo = (prefijo: string, indice: number, campo: string) => `${prefijo}-${indice}-${campo}`;

export function TablaCarga<F extends { clave: string }>({
  prefijo,
  titulo,
  filas,
  columnas,
  marcas,
  alCambiar,
  alQuitar,
}: {
  prefijo: string;
  /** Nombre accesible de la lista de filas. */
  titulo: string;
  filas: F[];
  columnas: ColumnaCarga<F>[];
  /** Marcas de la revisión: por índice de fila (desde 0) y campo. */
  marcas: Map<string, MarcaDeCampo[]>;
  alCambiar: (indice: number, campo: keyof F & string, valor: string) => void;
  alQuitar: (indice: number) => void;
}) {
  const plantilla = `2.75rem ${columnas.map((c) => `minmax(0, ${c.ancho ?? 1}fr)`).join(' ')} 2.75rem`;

  return (
    <div className={estilos.tabla} style={{ '--columnas': plantilla } as CSSProperties}>
      <div className={estilos.encabezado} aria-hidden="true">
        <span>#</span>
        {columnas.map((c) => (
          <span key={c.campo}>{c.etiqueta}</span>
        ))}
        <span />
      </div>
      <ol className={estilos.filas} aria-label={titulo}>
        {filas.map((fila, indice) => {
          const deLaFila = columnas.flatMap((c) => marcas.get(`${indice}:${c.campo}`) ?? []);
          const conError = deLaFila.some((m) => m.tono === 'error');
          const conAviso = !conError && deLaFila.length > 0;
          return (
            <li
              key={fila.clave}
              className={estilos.fila}
              data-estado={conError ? 'error' : conAviso ? 'aviso' : undefined}
            >
              <div className={estilos.numero}>
                <span className={estilos.numeroTexto}>
                  <span className={estilos.palabraFila}>Fila </span>
                  {indice + 1}
                </span>
                {conError && (
                  <span className={estilos.estadoFila}>
                    <Icono nombre="alerta" tamano={14} />
                    <span className="sr-only">, con errores</span>
                  </span>
                )}
              </div>
              {columnas.map((c) => {
                const id = idDeCampo(prefijo, indice, c.campo);
                const delCampo = marcas.get(`${indice}:${c.campo}`) ?? [];
                const invalido = delCampo.some((m) => m.tono === 'error');
                const descrito = delCampo.length > 0 ? `${id}-marca` : undefined;
                return (
                  <div key={c.campo} className={estilos.celda} data-campo={c.campo}>
                    {c.renderizar ? (
                      // Un grupo (casillas): su nombre lo da este texto por aria-labelledby, no un <label for>.
                      <span id={`${id}-etiqueta`} className={estilos.etiqueta}>
                        {c.etiqueta}
                        <span className="sr-only">, fila {indice + 1}</span>
                      </span>
                    ) : (
                      <label htmlFor={id} className={estilos.etiqueta}>
                        {c.etiqueta}
                        <span className="sr-only">, fila {indice + 1}</span>
                      </label>
                    )}
                    {c.renderizar ? (
                      c.renderizar(fila, indice, { id, idEtiqueta: `${id}-etiqueta`, descrito, invalido })
                    ) : (
                      <div className={estilos.control}>
                        {c.prefijo && (
                          <span className={estilos.prefijo} aria-hidden="true">
                            {c.prefijo}
                          </span>
                        )}
                        <input
                          id={id}
                          className="entrada"
                          data-con-prefijo={c.prefijo ? '' : undefined}
                          data-con-sufijo={c.sufijo ? '' : undefined}
                          value={String(fila[c.campo] ?? '')}
                          placeholder={c.placeholder}
                          inputMode={c.inputMode}
                          autoComplete="off"
                          aria-invalid={invalido || undefined}
                          aria-describedby={descrito}
                          onChange={(e) => alCambiar(indice, c.campo, e.target.value)}
                        />
                        {c.sufijo && (
                          <span className={estilos.sufijo} aria-hidden="true">
                            {c.sufijo}
                          </span>
                        )}
                      </div>
                    )}
                    {delCampo.length > 0 && (
                      <div id={descrito} className={estilos.marcas}>
                        {delCampo.map((m) => (
                          <p key={m.texto} className={estilos.marca} data-tono={m.tono}>
                            <Icono nombre={m.tono === 'error' ? 'alerta' : 'info'} tamano={14} />
                            <span>
                              <span className="sr-only">{m.tono === 'error' ? 'Error: ' : 'Atención: '}</span>
                              {m.texto}
                            </span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
              <div className={estilos.quitar}>
                <BotonIcono
                  icono="cerrar"
                  etiqueta={`Quitar la fila ${indice + 1}`}
                  onClick={() => alQuitar(indice)}
                />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
