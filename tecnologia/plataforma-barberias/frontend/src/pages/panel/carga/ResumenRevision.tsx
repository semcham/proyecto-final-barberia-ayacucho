import type { Ref } from 'react';
import { type ProblemaDeFila, type RevisionDeCarga, textoDelProblema } from '../../../api/carga-lote';
import { Icono } from '../../../components/Icono';
import estilos from '../CargaServicios.module.css';

const LIMITE_EN_LISTA = 8;

/**
 * 011 · Resumen de la revisión de una carga en lote: "todo listo", o las filas con errores (cada una lleva el foco a su
 * campo). Las advertencias (barberos con nombre repetido) no impiden guardar: se listan aparte, en ámbar.
 */
export function ResumenRevision({
  id,
  ref,
  revision,
  tipo,
  sustantivo,
  etiquetaDeCampo,
  textoDeCarga,
  alIrA,
}: {
  id: string;
  ref: Ref<HTMLDivElement>;
  revision: RevisionDeCarga;
  tipo: 'SERVICIOS' | 'BARBEROS';
  sustantivo: { uno: string; varios: string };
  etiquetaDeCampo: (campo: string) => string;
  /** Texto de un problema de la carga entera (fila null), si necesita datos de la pantalla (por ejemplo el cupo). */
  textoDeCarga?: (p: ProblemaDeFila) => string;
  alIrA: (p: ProblemaDeFila) => void;
}) {
  const listo = revision.errores.length === 0;
  const deFilas = revision.errores.filter((p) => p.fila !== null);
  const deLaCarga = revision.errores.filter((p) => p.fila === null);
  const filasConError = new Set(deFilas.map((p) => p.fila)).size;
  const filasConAviso = new Set(revision.advertencias.map((p) => p.fila)).size;
  const cuantos = (n: number) => (n === 1 ? `1 ${sustantivo.uno}` : `${n} ${sustantivo.varios}`);

  const lista = (problemas: ProblemaDeFila[]) => (
    <>
      <ul className={estilos.resumenLista}>
        {problemas.slice(0, LIMITE_EN_LISTA).map((p) => (
          <li key={`${p.fila}-${p.campo}-${p.problema}`}>
            <button type="button" className={estilos.enlace} onClick={() => alIrA(p)}>
              Fila {p.fila} · {etiquetaDeCampo(p.campo)}:
            </button>{' '}
            {textoDelProblema(p, tipo)}
          </li>
        ))}
      </ul>
      {problemas.length > LIMITE_EN_LISTA && (
        <p className={estilos.resumenTexto}>Y más: revisa las filas marcadas.</p>
      )}
    </>
  );

  return (
    <div
      ref={ref}
      tabIndex={-1}
      id={id}
      className={estilos.resumen}
      data-tono={listo ? (filasConAviso > 0 ? 'aviso' : 'exito') : 'error'}
      role={listo ? 'status' : 'alert'}
    >
      {listo ? (
        <>
          <p className={estilos.resumenTitulo}>
            <Icono nombre="check" tamano={18} />
            Todo listo: se {revision.filas === 1 ? 'creará' : 'crearán'} {cuantos(revision.filas)}. Pulsa
            «Guardar».
          </p>
          {filasConAviso > 0 && (
            <>
              <p className={estilos.resumenTexto}>
                {filasConAviso === 1 ? 'Una fila tiene un aviso' : `${filasConAviso} filas tienen avisos`} en
                ámbar: revisa que no sea la misma persona. Puedes guardar igual.
              </p>
              {lista(revision.advertencias)}
            </>
          )}
        </>
      ) : (
        <>
          <p className={estilos.resumenTitulo}>
            <Icono nombre="alerta" tamano={18} />
            {filasConError > 0
              ? `Hay ${filasConError === 1 ? '1 fila' : `${filasConError} filas`} con errores. Corrígelas y vuelve a revisar.`
              : 'Revisa la carga.'}
          </p>
          {deLaCarga.map((p) => (
            <p key={p.problema} className={estilos.resumenTexto}>
              {textoDeCarga?.(p) ?? textoDelProblema(p, tipo)}
            </p>
          ))}
          {lista(deFilas)}
        </>
      )}
    </div>
  );
}
