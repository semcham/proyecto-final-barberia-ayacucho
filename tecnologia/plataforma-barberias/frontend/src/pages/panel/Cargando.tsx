import { Esqueleto } from '../../components/ui';
import estilos from './Panel.module.css';

/** Bloque de carga de una sección del panel, anunciado a lectores de pantalla. */
export function Cargando({ texto = 'Cargando…' }: { texto?: string }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{texto}</span>
      <Esqueleto alto="6rem" />
    </div>
  );
}

/** Carga de una lista: filas con la misma forma que los elementos que llegarán. */
export function CargandoLista({ texto = 'Cargando…', filas = 3 }: { texto?: string; filas?: number }) {
  return (
    <div aria-busy="true">
      <span className="sr-only">{texto}</span>
      <ul className={estilos.lista} aria-hidden="true">
        {Array.from({ length: filas }, (_, i) => (
          <li key={i} className={estilos.elemento}>
            <span className={estilos.elementoTextos}>
              <Esqueleto ancho="55%" alto="1rem" />
              <Esqueleto ancho="80%" alto="0.75rem" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
