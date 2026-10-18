import type { components } from '../../api/schema-002';
import { ApiError } from '../../api/client';
import { fechaDeBarberia, horaConEtiqueta } from '../../hora-barberia';
import { ModalConfirmacion } from '../ui/ModalConfirmacion';
import estilos from './ModalConflictos.module.css';

export type CitaAfectada = components['schemas']['CitaAfectada'];

/** Citas afectadas de un 409 `CONFLICTO_CON_CITAS`, o null si el error es otro. */
export function citasEnConflicto(error: unknown): CitaAfectada[] | null {
  if (!(error instanceof ApiError) || error.codigo !== 'CONFLICTO_CON_CITAS') return null;
  return error.detalles as unknown as CitaAfectada[];
}

const enPalabras = (n: number, futuras = false) =>
  `${n} ${n === 1 ? 'cita' : 'citas'}${futuras ? (n === 1 ? ' futura' : ' futuras') : ''}`;

/**
 * Confirmación en dos pasos de un cambio que choca con citas activas (R11): muestra las citas afectadas
 * (sin datos del cliente) y aclara que no se cancelan.
 */
export function ModalConflictos({
  citas,
  zona,
  titulo,
  textoConfirmar,
  futuras = false,
  cargando,
  onConfirmar,
  onCancelar,
}: {
  citas: CitaAfectada[] | null;
  zona: string;
  titulo: string;
  textoConfirmar: string;
  /** "2 citas futuras" en lugar de "2 citas". */
  futuras?: boolean;
  cargando?: boolean;
  onConfirmar: () => void;
  onCancelar: () => void;
}) {
  const lista = citas ?? [];
  return (
    <ModalConfirmacion
      abierto={citas !== null}
      onAbiertoCambia={(abierto) => !abierto && onCancelar()}
      titulo={titulo}
      variante="primario"
      textoConfirmar={textoConfirmar}
      cargando={cargando}
      onConfirmar={onConfirmar}
      descripcion={
        <>
          Este cambio afecta a {enPalabras(lista.length, futuras)}. Las citas no se cancelan: seguirán activas
          y la agenda las marcará en conflicto para que las reprogrames o avises al cliente.
          {/* La descripción del diálogo es un párrafo: la lista va en líneas (span), no en <ul>. */}
          <span className={estilos.citas}>
            {lista.slice(0, 5).map((cita) => (
              <span key={cita.id} className={estilos.cita}>
                {fechaDeBarberia(cita.inicio, zona)}, {horaConEtiqueta(cita.inicio, zona)} · {cita.servicio}
              </span>
            ))}
            {lista.length > 5 && <span className={estilos.cita}>y {lista.length - 5} más</span>}
          </span>
        </>
      }
    />
  );
}
