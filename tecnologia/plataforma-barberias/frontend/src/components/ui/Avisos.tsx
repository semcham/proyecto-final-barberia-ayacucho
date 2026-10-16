import * as Toast from '@radix-ui/react-toast';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';
import { Icono, type NombreIcono } from '../Icono';
import estilos from './Avisos.module.css';

export type TonoAviso = 'exito' | 'error' | 'info';

export interface Aviso {
  tono: TonoAviso;
  titulo: string;
  descripcion?: string;
}

type Avisar = (aviso: Aviso) => void;

const ContextoAvisos = createContext<Avisar | null>(null);

const ICONO: Record<TonoAviso, NombreIcono> = { exito: 'check', error: 'alerta', info: 'info' };

/**
 * Avisos pasajeros (toasts) con Radix: se anuncian a lectores de pantalla, se pausan con el ratón o el foco,
 * se cierran deslizando o con Escape y F8 lleva el foco a la región de avisos.
 */
export function ProveedorAvisos({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<(Aviso & { id: number })[]>([]);

  const avisar = useCallback<Avisar>((aviso) => {
    setAvisos((actuales) => [...actuales.slice(-2), { ...aviso, id: Date.now() + Math.random() }]);
  }, []);

  const quitar = (id: number) => setAvisos((actuales) => actuales.filter((aviso) => aviso.id !== id));

  return (
    <ContextoAvisos.Provider value={avisar}>
      <Toast.Provider label="Avisos" swipeDirection="right" duration={5000}>
        {children}
        {avisos.map((aviso) => (
          <Toast.Root
            key={aviso.id}
            type={aviso.tono === 'error' ? 'foreground' : 'background'}
            className={`${estilos.aviso} ${estilos[aviso.tono]}`}
            onOpenChange={(abierto) => !abierto && quitar(aviso.id)}
          >
            <span className={estilos.icono}>
              <Icono nombre={ICONO[aviso.tono]} tamano={18} />
            </span>
            <div className={estilos.textos}>
              <Toast.Title className={estilos.titulo}>{aviso.titulo}</Toast.Title>
              {aviso.descripcion && (
                <Toast.Description className={estilos.descripcion}>{aviso.descripcion}</Toast.Description>
              )}
            </div>
            <Toast.Close className={estilos.cerrar}>
              <Icono nombre="cerrar" tamano={16} />
              <span className="sr-only">Cerrar aviso</span>
            </Toast.Close>
          </Toast.Root>
        ))}
        <Toast.Viewport className={estilos.region} />
      </Toast.Provider>
    </ContextoAvisos.Provider>
  );
}

/** Muestra un aviso pasajero: avisar({ tono: 'exito', titulo: 'Barbero creado' }). */
export function useAvisos(): Avisar {
  const avisar = useContext(ContextoAvisos);
  if (!avisar) throw new Error('useAvisos debe usarse dentro de <ProveedorAvisos>');
  return avisar;
}
