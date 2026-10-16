import type { ReactNode } from 'react';
import { Icono, type NombreIcono } from '../Icono';
import estilos from './EstadoVacio.module.css';

/** Mensaje para listas sin resultados: qué pasa y, si aplica, qué hacer. */
export function EstadoVacio({
  icono = 'buscar',
  titulo,
  descripcion,
  accion,
}: {
  icono?: NombreIcono;
  titulo: string;
  descripcion?: ReactNode;
  accion?: ReactNode;
}) {
  return (
    <div className={estilos.vacio}>
      <span className={estilos.icono}>
        <Icono nombre={icono} tamano={24} />
      </span>
      <p className={estilos.titulo}>{titulo}</p>
      {descripcion && <p className={estilos.descripcion}>{descripcion}</p>}
      {accion && <div className={estilos.accion}>{accion}</div>}
    </div>
  );
}
