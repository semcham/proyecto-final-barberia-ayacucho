import * as Dialog from '@radix-ui/react-dialog';
import { type ReactNode, type RefObject, useRef } from 'react';
import { Icono } from '../Icono';
import { Boton } from './Boton';
import estilos from './Modal.module.css';

interface PropiedadesModalConfirmacion {
  abierto: boolean;
  onAbiertoCambia: (abierto: boolean) => void;
  titulo: string;
  descripcion: ReactNode;
  textoConfirmar: string;
  textoCancelar?: string;
  /** "peligro" para acciones destructivas: el foco inicial queda en Cancelar. */
  variante?: 'peligro' | 'primario';
  cargando?: boolean;
  onConfirmar: () => void;
  /**
   * Control que recibe el foco al cerrar. Por defecto, el que tenía el foco al abrir; hace falta cuando ese
   * control desaparece (por ejemplo, la opción de un menú desplegable).
   */
  focoAlCerrar?: RefObject<HTMLElement | null>;
}

/**
 * Confirmación accesible (Radix Dialog con role="alertdialog"): atrapa el foco, se cierra con Escape y
 * devuelve el foco al control que la abrió. Reemplaza a window.confirm.
 */
export function ModalConfirmacion({
  abierto,
  onAbiertoCambia,
  titulo,
  descripcion,
  textoConfirmar,
  textoCancelar = 'Cancelar',
  variante = 'peligro',
  cargando = false,
  onConfirmar,
  focoAlCerrar,
}: PropiedadesModalConfirmacion) {
  const cancelar = useRef<HTMLButtonElement>(null);
  // Sin Dialog.Trigger, Radix no sabe a dónde devolver el foco: se recuerda el control que lo tenía al abrir.
  const origen = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={abierto} onOpenChange={(valor) => !cargando && onAbiertoCambia(valor)}>
      <Dialog.Portal>
        <Dialog.Overlay className={estilos.velo} />
        <Dialog.Content
          role="alertdialog"
          className={estilos.modal}
          onOpenAutoFocus={(evento) => {
            origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            if (variante === 'peligro') {
              evento.preventDefault();
              cancelar.current?.focus();
            }
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            const destino = focoAlCerrar?.current ?? origen.current;
            if (destino?.isConnected) destino.focus();
          }}
        >
          <div className={estilos.cabecera}>
            <span className={`${estilos.icono} ${variante === 'peligro' ? estilos.iconoPeligro : ''}`}>
              <Icono nombre={variante === 'peligro' ? 'alerta' : 'info'} />
            </span>
            <div>
              <Dialog.Title className={estilos.titulo}>{titulo}</Dialog.Title>
              <Dialog.Description className={estilos.descripcion}>{descripcion}</Dialog.Description>
            </div>
          </div>
          <div className={estilos.acciones}>
            <Dialog.Close asChild>
              <Boton ref={cancelar} variante="secundario" disabled={cargando}>
                {textoCancelar}
              </Boton>
            </Dialog.Close>
            <Boton variante={variante} cargando={cargando} onClick={onConfirmar}>
              {textoConfirmar}
            </Boton>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
