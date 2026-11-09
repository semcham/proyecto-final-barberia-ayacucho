import { ETIQUETA_HORA_BARBERIA, fechaDeBarberia, horaDeBarberia } from '../../hora-barberia';
import { Alerta } from '../ui/Alerta';
import { clasesBoton } from '../ui/Boton';
import { Esqueleto } from '../ui/Esqueleto';
import { EstadoVacio } from '../ui/EstadoVacio';
import estilos from './SelectorDeHora.module.css';

/** Una hora libre de GET /horarios (o de la vía pública): el inicio y los barberos libres a esa hora. */
export interface HoraLibre {
  inicio: string;
  barberoIds: string[];
}

/**
 * Selección de una hora libre (research R15 de 004): la usan el catálogo público al reservar (002) y la
 * reprogramación de una cita (004). Muestra los estados cargando, error y vacío ("no hay horas libres ese día"),
 * y las horas como botones conmutables, en la hora de la barbería. Las horas ya vienen filtradas por barbero.
 */
export function SelectorDeHora({
  cargando,
  error,
  horas,
  zona,
  elegida,
  onElegir,
}: {
  cargando: boolean;
  /** Mensaje del error al consultar las horas, o null. */
  error: string | null;
  horas: HoraLibre[];
  zona: string;
  elegida: string | null;
  onElegir: (inicio: string) => void;
}) {
  if (cargando) {
    return (
      <div aria-busy="true" className={estilos.horas}>
        <span className="sr-only">Buscando horas libres…</span>
        {Array.from({ length: 8 }, (_, i) => (
          <Esqueleto key={i} alto="var(--alto-control-sm)" />
        ))}
      </div>
    );
  }
  if (error !== null) return <Alerta>{error}</Alerta>;
  if (horas.length === 0) {
    return (
      <EstadoVacio
        icono="calendario"
        titulo="No hay horas libres ese día"
        descripcion="Prueba con otra fecha u otro barbero."
      />
    );
  }
  return (
    <>
      <p className={estilos.ayuda}>
        {fechaDeBarberia(horas[0].inicio, zona)} · horas en {ETIQUETA_HORA_BARBERIA}
      </p>
      <div role="group" aria-label="Horas libres" className={estilos.horas}>
        {horas.map((h) => (
          <button
            key={h.inicio}
            type="button"
            className={clasesBoton({
              variante: h.inicio === elegida ? 'primario' : 'secundario',
              tamano: 'sm',
            })}
            aria-pressed={h.inicio === elegida}
            onClick={() => onElegir(h.inicio)}
          >
            {horaDeBarberia(h.inicio, zona)}
          </button>
        ))}
      </div>
    </>
  );
}
