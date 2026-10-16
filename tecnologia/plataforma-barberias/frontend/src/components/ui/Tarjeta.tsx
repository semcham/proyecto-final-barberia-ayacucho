import { type ReactNode, useId } from 'react';
import { Icono, type NombreIcono } from '../Icono';
import estilos from './Tarjeta.module.css';

interface PropiedadesTarjeta {
  /** Con título, la tarjeta es una <section> nombrada por su encabezado. */
  titulo?: ReactNode;
  descripcion?: ReactNode;
  icono?: NombreIcono;
  /** Botones o enlaces alineados a la derecha del encabezado. */
  acciones?: ReactNode;
  nivelTitulo?: 2 | 3;
  /** Resalta la tarjeta con el borde y el brillo del acento. */
  destacada?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Contenedor de contenido con encabezado opcional (título, descripción, icono y acciones). */
export function Tarjeta({
  titulo,
  descripcion,
  icono,
  acciones,
  nivelTitulo = 2,
  destacada = false,
  className,
  children,
}: PropiedadesTarjeta) {
  const idTitulo = useId();
  const Titulo = nivelTitulo === 2 ? 'h2' : 'h3';
  const clases = ['tarjeta', estilos.tarjeta, destacada && estilos.destacada, className]
    .filter(Boolean)
    .join(' ');
  const encabezado = (titulo || acciones) && (
    <div className={estilos.encabezado}>
      {icono && (
        <span className={estilos.icono}>
          <Icono nombre={icono} />
        </span>
      )}
      {(titulo || descripcion) && (
        <div className={estilos.textos}>
          {titulo && (
            <Titulo id={idTitulo} className={estilos.titulo}>
              {titulo}
            </Titulo>
          )}
          {descripcion && <p className={estilos.descripcion}>{descripcion}</p>}
        </div>
      )}
      {acciones && <div className={estilos.acciones}>{acciones}</div>}
    </div>
  );

  if (titulo) {
    return (
      <section className={clases} aria-labelledby={idTitulo}>
        {encabezado}
        {children}
      </section>
    );
  }
  return (
    <div className={clases}>
      {encabezado}
      {children}
    </div>
  );
}
