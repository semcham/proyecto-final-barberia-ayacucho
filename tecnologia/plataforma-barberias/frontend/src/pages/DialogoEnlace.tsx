import * as Dialog from '@radix-ui/react-dialog';
import { useRef, useState } from 'react';
import type { components } from '../api/schema';
import { Icono } from '../components/Icono';
import { Boton, useAvisos } from '../components/ui';
import estilosModal from '../components/ui/Modal.module.css';
import estilos from './DialogoEnlace.module.css';

type EnlaceActivacion = components['schemas']['EnlaceActivacion'];

/**
 * Ventana con el enlace de activación recién generado y el botón para copiarlo. El foco empieza en
 * "Copiar enlace" y al cerrar vuelve al control que abrió la ventana.
 */
export function DialogoEnlace({
  enlace,
  onCerrar,
  alCerrarSinOrigen,
}: {
  enlace: EnlaceActivacion | null;
  onCerrar: () => void;
  /**
   * Se llama al cerrar si el control que abrió la ventana ya no puede recibir el foco (por ejemplo, el botón
   * "Crear barbero", que estaba deshabilitado mientras se creaba).
   */
  alCerrarSinOrigen?: () => void;
}) {
  const avisar = useAvisos();
  const [copiado, setCopiado] = useState(false);
  const botonCopiar = useRef<HTMLButtonElement>(null);
  const entrada = useRef<HTMLInputElement>(null);
  const origen = useRef<HTMLElement | null>(null);

  const copiar = async () => {
    if (!enlace) return;
    try {
      await navigator.clipboard.writeText(enlace.enlace);
      setCopiado(true);
    } catch {
      entrada.current?.select();
      avisar({
        tono: 'error',
        titulo: 'No se pudo copiar',
        descripcion: 'El enlace quedó seleccionado: cópialo manualmente.',
      });
    }
  };

  return (
    <Dialog.Root
      open={enlace !== null}
      onOpenChange={(abierto) => {
        if (!abierto) {
          setCopiado(false);
          onCerrar();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={estilosModal.velo} />
        <Dialog.Content
          className={`${estilosModal.modal} ${estilos.dialogo}`}
          onOpenAutoFocus={(evento) => {
            origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            evento.preventDefault();
            botonCopiar.current?.focus();
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            const destino = origen.current;
            if (destino?.isConnected && destino !== document.body && !destino.matches(':disabled'))
              destino.focus();
            else alCerrarSinOrigen?.();
          }}
        >
          {enlace && (
            <>
              <div className={estilosModal.cabecera}>
                <span className={estilos.icono}>
                  <Icono nombre="enlace" />
                </span>
                <div>
                  <Dialog.Title className={estilosModal.titulo}>Enlace de activación</Dialog.Title>
                  <Dialog.Description className={estilosModal.descripcion}>
                    Entrégaselo al barbero para que cree su contraseña. Sirve una sola vez.
                    <span className={estilos.vence}>
                      Vence el{' '}
                      {new Date(enlace.venceEn).toLocaleString('es-PE', {
                        dateStyle: 'long',
                        timeStyle: 'short',
                      })}
                    </span>
                  </Dialog.Description>
                </div>
              </div>
              <div className={estilos.copiar}>
                <input
                  ref={entrada}
                  readOnly
                  className={`entrada ${estilos.enlace}`}
                  value={enlace.enlace}
                  aria-label="Enlace de activación"
                  onFocus={(e) => e.target.select()}
                />
                <Boton ref={botonCopiar} icono={copiado ? 'check' : 'copiar'} onClick={copiar}>
                  {copiado ? 'Copiado' : 'Copiar enlace'}
                </Boton>
              </div>
              <p className={estilos.consejo}>
                <Icono nombre="info" tamano={16} />
                Puedes enviarlo por WhatsApp o mensaje de texto.
              </p>
              <div className={estilosModal.acciones}>
                <Dialog.Close asChild>
                  <Boton variante="secundario">Cerrar</Boton>
                </Dialog.Close>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
