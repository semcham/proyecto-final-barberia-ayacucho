import type { ReactNode } from 'react';
import estilos from './EncabezadoCliente.module.css';

/**
 * Título de una pantalla del panel del cliente (rediseño del 2026-11-24): un solo h1 en Fraunces, con un antetítulo y
 * una descripción opcionales, y acciones a la derecha en escritorio.
 */
export function EncabezadoCliente({
  antetitulo,
  titulo,
  descripcion,
  acciones,
}: {
  antetitulo?: ReactNode;
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <div className={estilos.encabezado}>
      <div className={estilos.textos}>
        {antetitulo && <p className={estilos.antetitulo}>{antetitulo}</p>}
        <h1 className={estilos.titulo}>{titulo}</h1>
        {descripcion && <p className={estilos.descripcion}>{descripcion}</p>}
      </div>
      {acciones && <div className={estilos.acciones}>{acciones}</div>}
    </div>
  );
}
