import type { ReactNode } from 'react';
import { Icono } from '../Icono';

/**
 * Mensaje en línea dentro de la pantalla. El de error usa role="alert" (uno por pantalla); el de éxito,
 * role="status". Para avisos pasajeros tras una acción se usa useAvisos().
 */
export function Alerta({ tono = 'error', children }: { tono?: 'error' | 'exito'; children: ReactNode }) {
  return (
    <p role={tono === 'error' ? 'alert' : 'status'} className={`alerta alerta--${tono}`}>
      <Icono nombre={tono === 'error' ? 'alerta' : 'check'} tamano={18} />
      <span>{children}</span>
    </p>
  );
}
