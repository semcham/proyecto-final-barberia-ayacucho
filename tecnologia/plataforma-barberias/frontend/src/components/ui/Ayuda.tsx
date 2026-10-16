import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';
import estilos from './Ayuda.module.css';

/**
 * Ayuda emergente (tooltip) accesible con Radix: aparece con el ratón y con el foco del teclado y se anuncia
 * como descripción del control. Es un complemento: el control debe tener su propio nombre accesible.
 */
export function Ayuda({
  contenido,
  lado = 'top',
  children,
}: {
  contenido: ReactNode;
  lado?: 'top' | 'right' | 'bottom' | 'left';
  children: ReactElement;
}) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content side={lado} sideOffset={6} className={estilos.ayuda} collisionPadding={8}>
            {contenido}
            <Tooltip.Arrow className={estilos.flecha} width={10} height={5} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  );
}
