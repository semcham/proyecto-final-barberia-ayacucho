import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { Icono, type NombreIcono } from '../Icono';
import estilos from './Menu.module.css';

// Menú desplegable accesible (Radix): flechas para moverse, Enter para elegir, Escape para cerrar y el foco
// vuelve al disparador. Se usa en el menú de usuario, el conmutador de tema y las acciones por fila.

/**
 * Raíz del menú, no modal: no oculta el resto de la página a los lectores de pantalla (aria-hidden) mientras
 * está abierto. El foco igual queda en el menú, Escape lo cierra y vuelve al disparador (patrón WAI-ARIA de
 * botón de menú).
 */
export function Menu(props: DropdownMenu.DropdownMenuProps) {
  return <DropdownMenu.Root modal={false} {...props} />;
}
export const MenuDisparador = DropdownMenu.Trigger;
export const MenuGrupoRadio = DropdownMenu.RadioGroup;

export function MenuContenido({
  children,
  alineacion = 'end',
  etiqueta,
}: {
  children: ReactNode;
  alineacion?: 'start' | 'center' | 'end';
  /** Nombre accesible del menú cuando el disparador no basta. */
  etiqueta?: string;
}) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        className={estilos.menu}
        align={alineacion}
        sideOffset={6}
        collisionPadding={8}
        aria-label={etiqueta}
      >
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({
  icono,
  peligro = false,
  disabled,
  onSelect,
  children,
}: {
  icono?: NombreIcono;
  peligro?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Item
      className={`${estilos.item} ${peligro ? estilos.peligro : ''}`}
      disabled={disabled}
      onSelect={onSelect}
    >
      {icono && <Icono nombre={icono} tamano={16} />}
      {children}
    </DropdownMenu.Item>
  );
}

export function MenuItemRadio({
  valor,
  icono,
  children,
}: {
  valor: string;
  icono?: NombreIcono;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.RadioItem value={valor} className={estilos.item}>
      {icono && <Icono nombre={icono} tamano={16} />}
      <span className={estilos.textoRadio}>{children}</span>
      <DropdownMenu.ItemIndicator className={estilos.indicador}>
        <Icono nombre="check" tamano={16} />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

/** Texto no interactivo dentro del menú (un encabezado o un resumen). */
export function MenuEtiqueta({ children, className }: { children: ReactNode; className?: string }) {
  return <DropdownMenu.Label className={className ?? estilos.etiqueta}>{children}</DropdownMenu.Label>;
}

export function MenuSeparador() {
  return <DropdownMenu.Separator className={estilos.separador} />;
}
