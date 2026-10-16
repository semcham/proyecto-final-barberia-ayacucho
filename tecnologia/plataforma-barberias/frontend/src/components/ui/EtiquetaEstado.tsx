import type { ReactNode } from 'react';
import estilos from './EtiquetaEstado.module.css';

export type TonoEtiqueta = 'exito' | 'aviso' | 'neutro' | 'error' | 'acento' | 'contorno';

/**
 * Etiqueta corta de estado. El color acompaña al texto, nunca lo reemplaza (el texto siempre dice el estado).
 */
export function EtiquetaEstado({
  tono,
  punto = tono !== 'contorno',
  children,
}: {
  tono: TonoEtiqueta;
  punto?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={`${estilos.etiqueta} ${estilos[tono]}`}>
      {punto && <span className={estilos.punto} aria-hidden="true" />}
      {children}
    </span>
  );
}
