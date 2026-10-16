import type { ButtonHTMLAttributes, Ref } from 'react';
import { Icono, type NombreIcono } from '../Icono';
import { Ayuda } from './Ayuda';
import { clasesBoton, type TamanoBoton, type VarianteBoton } from './Boton';

// En su propio archivo: trae el tooltip de Radix, que las pantallas que solo usan Boton no necesitan.
interface PropiedadesBotonIcono extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  ref?: Ref<HTMLButtonElement>;
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  icono: NombreIcono;
  /** Nombre accesible; también se muestra como ayuda emergente. */
  etiqueta: string;
}

/** Botón cuadrado solo con icono. El nombre accesible es texto oculto (no aria-label) y hay ayuda emergente. */
export function BotonIcono({
  icono,
  etiqueta,
  variante = 'fantasma',
  tamano,
  className,
  ...resto
}: PropiedadesBotonIcono) {
  return (
    <Ayuda contenido={etiqueta}>
      <button
        type="button"
        className={clasesBoton({ variante, tamano, soloIcono: true, className })}
        {...resto}
      >
        <Icono nombre={icono} tamano={tamano === 'sm' ? 16 : 20} />
        <span className="sr-only">{etiqueta}</span>
      </button>
    </Ayuda>
  );
}
