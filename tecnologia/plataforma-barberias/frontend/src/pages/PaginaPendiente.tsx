import { EstadoVacio } from '../components/ui';

/**
 * Esqueleto de las pantallas de la funcionalidad 002 (T038). Cada historia reemplaza la ruta por su
 * pantalla real; mientras tanto, la ruta existe y se carga de forma diferida (ADR-018).
 */
export default function PaginaPendiente({ titulo }: { titulo: string }) {
  return (
    <section aria-labelledby="titulo-pendiente">
      <h1 id="titulo-pendiente">{titulo}</h1>
      <EstadoVacio icono="reloj" titulo="Muy pronto" descripcion="Esta sección estará disponible en breve." />
    </section>
  );
}
