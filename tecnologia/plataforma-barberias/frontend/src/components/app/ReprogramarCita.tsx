import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ApiError, llamarApi } from '../../api/client';
import type { components as Esquemas002 } from '../../api/schema-002';
import type { components as Esquemas004 } from '../../api/schema-004';
import {
  fechaDeBarberia,
  fechaIsoDeBarberia,
  horaConEtiqueta,
  horaDeBarberia,
  sumarDiasIso,
} from '../../hora-barberia';
import { HORIZONTE_RESERVA_DIAS } from '../../legal';
import { Alerta } from '../ui/Alerta';
import { Boton } from '../ui/Boton';
import modal from '../ui/Modal.module.css';
import estilos from './ReprogramarCita.module.css';
import { SelectorDeHora } from './SelectorDeHora';

type HorariosLibres = Esquemas002['schemas']['HorariosLibres'];
export type CitaReprogramada = Esquemas004['schemas']['CitaReprogramada'];

/** Lo mínimo de la cita que se reprograma (Cita de Mis citas o CitaAgenda de la agenda). */
export interface CitaAReprogramar {
  id: string;
  servicio: string;
  barbero: string;
  inicio: string;
}

/** Un barbero que puede atender la cita: los que ofrecen su servicio. */
export interface BarberoElegible {
  id: string;
  nombre: string;
}

const mensajeDe = (error: unknown) =>
  error instanceof ApiError ? error.message : 'No pudimos conectar con el servidor. Intenta de nuevo.';

/**
 * Reprogramar una cita (RF13; research R15 de 004): misma selección de hora que el catálogo (SelectorDeHora),
 * para el servicio de la cita, el día y el barbero elegidos (por defecto, los de la cita). Confirma con
 * POST /citas/{id}/reprogramar. Si la hora se ocupó (409), lo dice, vuelve a pedir las horas y la cita sigue
 * igual; si al cliente le falta antelación (422), ofrece cancelar (`onCancelar`). Montarlo solo mientras está
 * abierto.
 */
export function ReprogramarCita({
  cita,
  servicioId,
  barberos,
  barberoActualId,
  zona,
  comoCliente,
  onCerrar,
  onReprogramada,
  onCancelar,
}: {
  cita: CitaAReprogramar;
  /** Id del servicio de la cita en el catálogo vigente; null si ya no se ofrece. */
  servicioId: string | null;
  barberos: BarberoElegible[];
  barberoActualId: string | null;
  zona: string;
  comoCliente: boolean;
  onCerrar: () => void;
  onReprogramada: (resultado: CitaReprogramada) => void;
  /** Para el 422 sin antelación: cerrar esto y abrir la cancelación de la cita. */
  onCancelar?: () => void;
}) {
  const consultas = useQueryClient();
  const hoy = fechaIsoDeBarberia(new Date(), zona);
  const diaDeLaCita = fechaIsoDeBarberia(new Date(cita.inicio), zona);
  const [fecha, setFecha] = useState(diaDeLaCita >= hoy ? diaDeLaCita : hoy);
  const [barberoId, setBarberoId] = useState(barberoActualId ?? barberos[0]?.id ?? '');
  const [inicio, setInicio] = useState<string | null>(null);
  // Sin Dialog.Trigger, Radix no sabe a dónde devolver el foco: se recuerda el control que lo tenía al abrir.
  const origen = useRef<HTMLElement | null>(null);

  const horarios = useQuery({
    queryKey: ['horarios-reprogramar', servicioId, fecha],
    queryFn: () =>
      llamarApi<HorariosLibres>(`/horarios?${new URLSearchParams({ servicio: servicioId ?? '', fecha })}`),
    enabled: servicioId !== null && /^\d{4}-\d{2}-\d{2}$/.test(fecha),
  });
  const horas = (horarios.data?.horas ?? []).filter((h) => h.barberoIds.includes(barberoId));
  const hora = horas.find((h) => h.inicio === inicio);

  const reprogramar = useMutation({
    mutationFn: (destino: { inicio: string; barberoId: string }) =>
      llamarApi<CitaReprogramada>(`/citas/${cita.id}/reprogramar`, { metodo: 'POST', cuerpo: destino }),
    onSuccess: (resultado) => {
      void consultas.invalidateQueries({ queryKey: ['horarios-reprogramar'] });
      onReprogramada(resultado);
    },
    onError: (error) => {
      // La hora se ocupó o la cita cambió: se vuelven a pedir las horas libres. 008: si la cita espera su adelanto, la
      // hora no es el problema.
      if (error instanceof ApiError && error.estado === 409 && error.codigo !== 'ADELANTO_PENDIENTE') {
        setInicio(null);
        void horarios.refetch();
      }
    },
  });

  const error = reprogramar.error;
  const sinAntelacion = error instanceof ApiError && error.codigo === 'SIN_ANTELACION_PARA_REPROGRAMAR';
  // 008 (research R11): la cita pendiente de su adelanto no la reprograma el cliente: paga, espera o cancela.
  const adelantoPendiente = error instanceof ApiError && error.codigo === 'ADELANTO_PENDIENTE';
  const cuandoActual = `${fechaDeBarberia(cita.inicio, zona)} a las ${horaConEtiqueta(cita.inicio, zona)}`;

  return (
    <Dialog.Root open onOpenChange={(abierto) => !abierto && !reprogramar.isPending && onCerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modal.velo} />
        <Dialog.Content
          className={`${modal.modal} ${estilos.dialogo}`}
          onOpenAutoFocus={() => {
            origen.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            if (origen.current?.isConnected) origen.current.focus();
          }}
        >
          <Dialog.Title className={modal.titulo}>Reprogramar la cita</Dialog.Title>
          <Dialog.Description className={modal.descripcion}>
            {cita.servicio} con {cita.barbero}, {cuandoActual}. Elige la nueva hora: si no está libre al
            confirmar, la cita se queda como está.
          </Dialog.Description>

          {servicioId === null ? (
            <Alerta>
              La barbería ya no ofrece este servicio, así que no se puede reprogramar. Puedes cancelar la cita
              y reservar otro servicio.
            </Alerta>
          ) : (
            <div className={estilos.formulario}>
              <div className={estilos.fila}>
                <div className="campo">
                  <label htmlFor="reprogramar-barbero" className="campo__etiqueta">
                    Barbero
                  </label>
                  <select
                    id="reprogramar-barbero"
                    className="entrada"
                    value={barberoId}
                    onChange={(evento) => {
                      setBarberoId(evento.target.value);
                      setInicio(null);
                    }}
                  >
                    {barberos.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nombre}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="campo">
                  <label htmlFor="reprogramar-fecha" className="campo__etiqueta">
                    Fecha
                  </label>
                  <input
                    id="reprogramar-fecha"
                    type="date"
                    className="entrada"
                    min={hoy}
                    max={sumarDiasIso(hoy, HORIZONTE_RESERVA_DIAS)}
                    value={fecha}
                    onChange={(evento) => {
                      setFecha(evento.target.value);
                      setInicio(null);
                    }}
                  />
                </div>
              </div>
              <SelectorDeHora
                cargando={horarios.isPending}
                error={horarios.isError ? mensajeDe(horarios.error) : null}
                horas={horas}
                zona={zona}
                elegida={inicio}
                onElegir={(valor) => {
                  setInicio(valor);
                  reprogramar.reset();
                }}
              />
            </div>
          )}

          {error && !horarios.isError && (
            <Alerta>
              {error instanceof ApiError && error.estado === 409 && !adelantoPendiente
                ? `${error.message} ${comoCliente ? 'Tu cita sigue' : 'La cita sigue'} el ${cuandoActual}.`
                : mensajeDe(error)}
            </Alerta>
          )}

          <div className={modal.acciones}>
            <Dialog.Close asChild>
              <Boton variante="secundario" disabled={reprogramar.isPending}>
                Volver
              </Boton>
            </Dialog.Close>
            {(sinAntelacion || adelantoPendiente) && onCancelar ? (
              <Boton variante="peligro" onClick={onCancelar}>
                Cancelar la cita
              </Boton>
            ) : (
              <Boton
                disabled={!hora}
                cargando={reprogramar.isPending}
                textoCargando="Reprogramando…"
                onClick={() => hora && reprogramar.mutate({ inicio: hora.inicio, barberoId })}
              >
                {hora ? `Reprogramar a las ${horaDeBarberia(hora.inicio, zona)}` : 'Elige una hora'}
              </Boton>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
