import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { type AdelantoEnBandeja, apiAdelanto, clavesAdelanto } from '../../api/adelanto';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { useArchivoLocal } from '../../components/archivo-local';
import { Icono } from '../../components/Icono';
import {
  Alerta,
  Boton,
  EstadoVacio,
  EtiquetaEstado,
  ModalConfirmacion,
  useAvisos,
} from '../../components/ui';
import modal from '../../components/ui/Modal.module.css';
import { fechaDeBarberia, horaConEtiqueta, horaDeBarberia } from '../../hora-barberia';
import { soles } from '../cliente/textos-adelanto';
import { CargandoLista } from './Cargando';
import { mensajeDeError, useBarberia } from './datos-barberia';
import estilos from './Panel.module.css';

// T045 de 008 · Bandeja de verificación del propietario (/app/adelantos; US3, FR-012 a FR-014): los pagos de
// adelanto por revisar, con lo necesario para comprobarlos en su aplicación de Yape o Plin (monto, código de la
// reserva, número de operación y captura) y los plazos. Confirmar (la cita pasa a confirmada) pide confirmación en un
// diálogo accesible; rechazar exige un motivo, que el cliente recibe.

const ERROR_MOTIVO = 'Escribe el motivo del rechazo (de 5 a 300 caracteres).';

export default function AdelantosPorRevisar() {
  const barberia = useBarberia();
  const zona = barberia.data?.zonaHoraria ?? 'America/Lima';
  const bandeja = useQuery({ queryKey: clavesAdelanto.bandeja, queryFn: apiAdelanto.porRevisar });
  const [porConfirmar, setPorConfirmar] = useState<AdelantoEnBandeja | null>(null);
  const [porRechazar, setPorRechazar] = useState<AdelantoEnBandeja | null>(null);

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Adelantos por revisar' }]}
        titulo="Adelantos por revisar"
        descripcion="Comprueba cada pago en tu aplicación de Yape o Plin, con el código de la reserva y el número de operación, y confírmalo o recházalo. La cita se confirma solo cuando confirmas su pago."
      />
      <section aria-labelledby="titulo-bandeja">
        <h2 id="titulo-bandeja" className="sr-only">
          Pagos por revisar
        </h2>
        {bandeja.isPending ? (
          <CargandoLista texto="Cargando los pagos por revisar…" filas={3} />
        ) : bandeja.isError ? (
          <Alerta>{mensajeDeError(bandeja.error)}</Alerta>
        ) : bandeja.data.length === 0 ? (
          <EstadoVacio
            icono="check"
            titulo="No hay pagos por revisar"
            descripcion="Cuando un cliente registre el pago de su adelanto, aparecerá aquí y te avisaremos por correo."
          />
        ) : (
          <ul className={estilos.lista} aria-label="Pagos por revisar">
            {bandeja.data.map((item) => (
              <PagoPorRevisar
                key={item.citaId}
                item={item}
                zona={zona}
                onConfirmar={() => setPorConfirmar(item)}
                onRechazar={() => setPorRechazar(item)}
              />
            ))}
          </ul>
        )}
      </section>
      <ConfirmarPago item={porConfirmar} onCerrar={() => setPorConfirmar(null)} />
      <RechazarPago item={porRechazar} onCerrar={() => setPorRechazar(null)} />
    </>
  );
}

function PagoPorRevisar({
  item,
  zona,
  onConfirmar,
  onRechazar,
}: {
  item: AdelantoEnBandeja;
  zona: string;
  onConfirmar: () => void;
  onRechazar: () => void;
}) {
  const { adelanto } = item;
  const captura = useArchivoLocal();
  const [errorCaptura, setErrorCaptura] = useState<string | null>(null);
  // "Ahora" fijo durante la visita: decide si la hora límite de pago ya pasó (el límite de revisión sigue vigente).
  const [ahora] = useState(() => Date.now());
  const plazoVencido = ahora >= Date.parse(adelanto.horaLimite);
  const verCaptura = async () => {
    setErrorCaptura(null);
    try {
      captura.mostrar(await apiAdelanto.captura(item.citaId));
    } catch (causa) {
      setErrorCaptura(mensajeDeError(causa));
    }
  };
  const filas: [string, string][] = [
    ['Monto', soles(adelanto.montoCentimos)],
    ['Código de la reserva', adelanto.codigo],
    ['Número de operación', adelanto.pago?.numeroOperacion ?? '—'],
    [
      'Hora límite de pago',
      `${fechaDeBarberia(adelanto.horaLimite, zona)}, ${horaConEtiqueta(adelanto.horaLimite, zona)}`,
    ],
    [
      'Revisar hasta',
      `${fechaDeBarberia(adelanto.limiteRevision, zona)}, ${horaConEtiqueta(adelanto.limiteRevision, zona)}`,
    ],
  ];

  return (
    <li className={estilos.elemento}>
      <div className={estilos.formulario}>
        <div className={estilos.elementoTextos}>
          <span className={estilos.elementoNombre}>{item.cliente}</span>
          <span className={estilos.elementoDetalle}>
            {item.servicio} · {item.barbero} · {fechaDeBarberia(item.inicio, zona)},{' '}
            {horaDeBarberia(item.inicio, zona)}
          </span>
        </div>
        {plazoVencido && (
          <EtiquetaEstado tono="aviso">
            Hora límite pasada: decide antes del límite de revisión
          </EtiquetaEstado>
        )}
        <dl className={estilos.lista} aria-label={`Pago de ${item.cliente}`}>
          {filas.map(([termino, valor]) => (
            <div key={termino} className={estilos.elemento}>
              <dt className={estilos.elementoDetalle}>{termino}</dt>
              <dd className={estilos.elementoNombre}>{valor}</dd>
            </div>
          ))}
        </dl>
        <div className={estilos.acciones}>
          {adelanto.pago?.tieneCaptura && (
            <Boton
              type="button"
              variante="secundario"
              tamano="sm"
              icono="documento"
              onClick={() => void verCaptura()}
            >
              Ver la captura<span className="sr-only"> de {item.cliente}</span>
            </Boton>
          )}
          <Boton type="button" tamano="sm" icono="check" onClick={onConfirmar}>
            Confirmar<span className="sr-only"> el pago de {item.cliente}</span>
          </Boton>
          <Boton type="button" variante="peligro" tamano="sm" onClick={onRechazar}>
            Rechazar<span className="sr-only"> el pago de {item.cliente}</span>
          </Boton>
        </div>
        {captura.url && (
          <a href={captura.url} target="_blank" rel="noopener noreferrer">
            Abrir la captura (el enlace dura 1 minuto)
          </a>
        )}
        {errorCaptura && <Alerta>{errorCaptura}</Alerta>}
      </div>
    </li>
  );
}

function ConfirmarPago({ item, onCerrar }: { item: AdelantoEnBandeja | null; onCerrar: () => void }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const confirmar = useMutation({
    mutationFn: (citaId: string) => apiAdelanto.confirmar(citaId),
    onSuccess: () => {
      onCerrar();
      avisar({ tono: 'exito', titulo: 'Pago confirmado', descripcion: 'La cita quedó confirmada.' });
      void consultas.invalidateQueries({ queryKey: clavesAdelanto.bandeja });
    },
    onError: (error) => {
      onCerrar();
      avisar({ tono: 'error', titulo: 'No se pudo confirmar el pago', descripcion: mensajeDeError(error) });
      void consultas.invalidateQueries({ queryKey: clavesAdelanto.bandeja });
    },
  });
  return (
    <ModalConfirmacion
      abierto={item !== null}
      onAbiertoCambia={(abierto) => !abierto && onCerrar()}
      titulo="¿Confirmar el pago del adelanto?"
      descripcion={
        item ? (
          <>
            Confirma solo si en tu aplicación de Yape o Plin ves el pago de{' '}
            {soles(item.adelanto.montoCentimos)} con el código {item.adelanto.codigo} (operación{' '}
            {item.adelanto.pago?.numeroOperacion}). La cita de {item.cliente} quedará confirmada y le
            avisaremos.
          </>
        ) : null
      }
      textoConfirmar="Confirmar pago"
      variante="primario"
      cargando={confirmar.isPending}
      onConfirmar={() => item && confirmar.mutate(item.citaId)}
    />
  );
}

function RechazarPago({ item, onCerrar }: { item: AdelantoEnBandeja | null; onCerrar: () => void }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const idMotivo = useId();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rechazar = useMutation({
    mutationFn: ({ citaId, texto }: { citaId: string; texto: string }) => apiAdelanto.rechazar(citaId, texto),
    onSuccess: () => {
      cerrar();
      avisar({
        tono: 'exito',
        titulo: 'Pago rechazado',
        descripcion: 'Le avisamos al cliente con el motivo.',
      });
      void consultas.invalidateQueries({ queryKey: clavesAdelanto.bandeja });
    },
  });
  const cerrar = () => {
    setMotivo('');
    setError(null);
    rechazar.reset();
    onCerrar();
  };
  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const texto = motivo.trim();
    if (texto.length < 5 || texto.length > 300) {
      setError(ERROR_MOTIVO);
      return;
    }
    setError(null);
    if (item) rechazar.mutate({ citaId: item.citaId, texto });
  };

  return (
    <Dialog.Root open={item !== null} onOpenChange={(abierto) => !abierto && !rechazar.isPending && cerrar()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modal.velo} />
        <Dialog.Content className={modal.modal}>
          <div className={modal.cabecera}>
            <span className={`${modal.icono} ${modal.iconoPeligro}`}>
              <Icono nombre="alerta" />
            </span>
            <div>
              <Dialog.Title className={modal.titulo}>Rechazar el pago del adelanto</Dialog.Title>
              <Dialog.Description className={modal.descripcion}>
                {item
                  ? `${item.cliente} recibirá el motivo y podrá registrar otro número antes de su hora límite.`
                  : null}
              </Dialog.Description>
            </div>
          </div>
          <form onSubmit={enviar} noValidate className={estilos.formulario}>
            <div className="campo">
              <label htmlFor={idMotivo} className="campo__etiqueta">
                Motivo del rechazo
              </label>
              <textarea
                id={idMotivo}
                className="entrada"
                rows={3}
                maxLength={300}
                value={motivo}
                onChange={(evento) => setMotivo(evento.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${idMotivo}-error` : `${idMotivo}-ayuda`}
              />
              <p id={`${idMotivo}-ayuda`} className="campo__ayuda">
                Por ejemplo: «No aparece en Yape» o «El monto no coincide». De 5 a 300 caracteres.
              </p>
              {error && (
                <p id={`${idMotivo}-error`} className="mensaje-error">
                  <Icono nombre="alerta" tamano={16} />
                  {error}
                </p>
              )}
            </div>
            {rechazar.isError && <Alerta>{mensajeDeError(rechazar.error)}</Alerta>}
            <div className={modal.acciones}>
              <Dialog.Close asChild>
                <Boton type="button" variante="secundario" disabled={rechazar.isPending}>
                  Cancelar
                </Boton>
              </Dialog.Close>
              <Boton
                type="submit"
                variante="peligro"
                cargando={rechazar.isPending}
                textoCargando="Rechazando…"
              >
                Rechazar pago
              </Boton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
