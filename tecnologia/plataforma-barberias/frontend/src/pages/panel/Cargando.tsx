import { Esqueleto } from '../../components/ui';

/** Bloque de carga de una sección del panel, anunciado a lectores de pantalla. */
export function Cargando() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Cargando…</span>
      <Esqueleto alto="6rem" />
    </div>
  );
}
