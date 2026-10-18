import { useState } from 'react';
import type { components } from '../../api/schema-002';
import { fechaDeBarberia, horaConEtiqueta, horaDeBarberia } from '../../hora-barberia';
import { ModalConfirmacion } from '../ui/ModalConfirmacion';

type Cita = components['schemas']['Cita'];

/**
 * Confirmación de la cancelación de una cita (RF14, FR-038), compartida por el cliente (confirmación de la
 * reserva) y el propietario (agenda). Al cliente le avisa, antes de confirmar, si la cancelación quedará
 * como tardía según la antelación mínima de la barbería (`cancelacionTardiaDesde`). Al propietario le
 * recuerda que su cancelación nunca se marca como tardía. Montarlo solo mientras está abierto: "ahora" se
 * toma al abrir.
 */
export function ConfirmarCancelacion({
  cita,
  zona,
  comoCliente,
  cargando,
  onConfirmar,
  onCerrar,
}: {
  cita: Pick<Cita, 'inicio' | 'servicio' | 'cancelacionTardiaDesde'>;
  zona: string;
  comoCliente: boolean;
  cargando?: boolean;
  onConfirmar: () => void;
  onCerrar: () => void;
}) {
  const [ahora] = useState(() => Date.now());
  const desde = cita.cancelacionTardiaDesde;
  const tardia = comoCliente && desde !== undefined && ahora >= Date.parse(desde);
  const cuando = `${fechaDeBarberia(cita.inicio, zona)}, ${horaConEtiqueta(cita.inicio, zona)}`;

  let aviso: string;
  if (!comoCliente) {
    aviso = 'El horario queda libre de inmediato. La cancelación no se marcará como tardía para el cliente.';
  } else if (tardia) {
    aviso =
      'Faltan menos horas que la antelación mínima de la barbería: la cita quedará marcada como cancelación tardía. El horario queda libre de inmediato.';
  } else {
    aviso = desde
      ? `Si cancelas ahora, no quedará como cancelación tardía (puedes hacerlo así hasta las ${horaDeBarberia(desde, zona)} del ${fechaDeBarberia(desde, zona)}).`
      : 'El horario queda libre de inmediato.';
  }

  return (
    <ModalConfirmacion
      abierto
      onAbiertoCambia={(abierto) => !abierto && onCerrar()}
      titulo="¿Cancelar la cita?"
      descripcion={`${cita.servicio}, ${cuando}. ${aviso}`}
      textoConfirmar="Sí, cancelar la cita"
      textoCancelar="Volver"
      variante="peligro"
      cargando={cargando}
      onConfirmar={onConfirmar}
    />
  );
}
