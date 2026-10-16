import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icono } from '../Icono';
import estilos from './EncabezadoPagina.module.css';

export interface Miga {
  etiqueta: string;
  /** Ruta del enlace; la última miga (la página actual) no lo lleva. */
  a?: string;
}

/** Encabezado común de las páginas con sesión: migas de pan, título (h1), descripción y acciones. */
export function EncabezadoPagina({
  migas,
  antetitulo,
  titulo,
  descripcion,
  acciones,
}: {
  migas: Miga[];
  antetitulo?: string;
  titulo: ReactNode;
  descripcion?: ReactNode;
  acciones?: ReactNode;
}) {
  return (
    <header className={estilos.encabezado}>
      <nav aria-label="Migas de pan" className={estilos.migas}>
        <ol>
          {migas.map((miga, i) => {
            const ultima = i === migas.length - 1;
            return (
              <li key={miga.etiqueta}>
                {miga.a && !ultima ? (
                  <Link to={miga.a}>{miga.etiqueta}</Link>
                ) : (
                  <span aria-current={ultima ? 'page' : undefined}>{miga.etiqueta}</span>
                )}
                {!ultima && (
                  <span className={estilos.separador}>
                    <Icono nombre="chevronDerecha" tamano={14} />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className={estilos.fila}>
        <div className={estilos.textos}>
          {antetitulo && <p className="antetitulo">{antetitulo}</p>}
          <h1 className={estilos.titulo}>{titulo}</h1>
          {descripcion && <p className={estilos.descripcion}>{descripcion}</p>}
        </div>
        {acciones && <div className={estilos.acciones}>{acciones}</div>}
      </div>
    </header>
  );
}
