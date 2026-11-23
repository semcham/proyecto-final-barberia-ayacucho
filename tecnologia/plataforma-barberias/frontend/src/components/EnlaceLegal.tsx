import type { ReactNode } from 'react';

/**
 * Enlace a un texto legal desde un formulario (010, FR-025): se abre en otra pestaña para no perder lo escrito, sin
 * dar acceso a esta ventana (noopener) y avisando a los lectores de pantalla.
 */
export function EnlaceLegal({ a, children }: { a: '/terminos' | '/privacidad'; children: ReactNode }) {
  return (
    <a href={a} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}
