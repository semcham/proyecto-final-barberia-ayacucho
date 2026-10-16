import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { Icono, type NombreIcono } from '../Icono';

export type VarianteBoton = 'primario' | 'secundario' | 'peligro' | 'fantasma';
export type TamanoBoton = 'md' | 'sm';

interface OpcionesClase {
  variante?: VarianteBoton;
  tamano?: TamanoBoton;
  bloque?: boolean;
  soloIcono?: boolean;
  className?: string;
}

/** Clases de botón, también para enlaces que deben verse como botón (<Link className={clasesBoton(...)}>). */
export function clasesBoton({
  variante = 'primario',
  tamano = 'md',
  bloque = false,
  soloIcono = false,
  className,
}: OpcionesClase = {}): string {
  return [
    'boton',
    `boton--${variante}`,
    tamano === 'sm' && 'boton--sm',
    bloque && 'boton--bloque',
    soloIcono && 'boton--icono',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}

export interface PropiedadesBoton
  extends ButtonHTMLAttributes<HTMLButtonElement>, Omit<OpcionesClase, 'soloIcono'> {
  ref?: Ref<HTMLButtonElement>;
  /** Mientras es true el botón queda deshabilitado, con aria-busy e indicador de carga. */
  cargando?: boolean;
  /** Texto que reemplaza al contenido mientras carga (por ejemplo, "Guardando…"). */
  textoCargando?: ReactNode;
  icono?: NombreIcono;
  iconoFinal?: NombreIcono;
}

/** Botón del sistema de diseño: variantes primario, secundario, peligro y fantasma, con estado de carga. */
export function Boton({
  ref,
  variante,
  tamano,
  bloque,
  className,
  cargando = false,
  textoCargando,
  icono,
  iconoFinal,
  disabled,
  type = 'button',
  children,
  ...resto
}: PropiedadesBoton) {
  const tamanoIcono = tamano === 'sm' ? 16 : 18;
  return (
    <button
      ref={ref}
      type={type}
      className={clasesBoton({ variante, tamano, bloque, className })}
      disabled={disabled || cargando}
      aria-busy={cargando || undefined}
      {...resto}
    >
      {cargando ? (
        <span className="girador" aria-hidden="true" />
      ) : (
        icono && <Icono nombre={icono} tamano={tamanoIcono} />
      )}
      {cargando && textoCargando ? textoCargando : children}
      {!cargando && iconoFinal && <Icono nombre={iconoFinal} tamano={tamanoIcono} />}
    </button>
  );
}
