import { IlustracionBarberia } from './IlustracionBarberia';
import estilos from './ImagenMarca.module.css';

interface PropiedadesImagenMarca {
  /**
   * Foto real (por ejemplo "/img/barberia.webp", ver public/img/README.md). Sin foto se muestra la
   * ilustración propia de barbería.
   */
  src?: string;
  /** Texto alternativo de la foto. Vacío si es decorativa (lo habitual en el panel de marca). */
  alt?: string;
  /** object-position de la foto, para encuadrar el motivo principal (por ejemplo "30% center"). */
  encuadre?: string;
}

/**
 * Imagen del panel de marca con una capa oscura encima para que el texto mantenga el contraste, sea la
 * ilustración o una foto. Ocupa todo su contenedor (que debe tener position: relative).
 */
export function ImagenMarca({ src, alt = '', encuadre = 'center' }: PropiedadesImagenMarca) {
  return (
    <div className={estilos.marco} aria-hidden={src && alt ? undefined : true}>
      {src ? (
        <img
          src={src}
          alt={alt}
          className={estilos.foto}
          style={{ objectPosition: encuadre }}
          decoding="async"
        />
      ) : (
        <div className={estilos.contenedorIlustracion}>
          <IlustracionBarberia />
        </div>
      )}
      <div className={`${estilos.capa} ${src ? estilos.capaFoto : ''}`} />
    </div>
  );
}
