import type { CSSProperties } from 'react';
import estilos from './Esqueleto.module.css';

/**
 * Bloque de carga con brillo suave. Es decorativo (aria-hidden): el contenedor que lo usa debe marcar
 * aria-busy y anunciar "Cargando…" con texto oculto.
 */
export function Esqueleto({
  ancho = '100%',
  alto = '1rem',
  redondo = false,
  className,
}: {
  ancho?: CSSProperties['width'];
  alto?: CSSProperties['height'];
  redondo?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={[estilos.esqueleto, redondo && estilos.redondo, className].filter(Boolean).join(' ')}
      style={{ width: ancho, height: alto }}
    />
  );
}

/** Varias líneas de texto en carga; la última más corta. */
export function EsqueletoTexto({ lineas = 3 }: { lineas?: number }) {
  return (
    <span className={estilos.texto} aria-hidden="true">
      {Array.from({ length: lineas }, (_, i) => (
        <Esqueleto key={i} ancho={i === lineas - 1 ? '60%' : '100%'} alto="0.75rem" />
      ))}
    </span>
  );
}
