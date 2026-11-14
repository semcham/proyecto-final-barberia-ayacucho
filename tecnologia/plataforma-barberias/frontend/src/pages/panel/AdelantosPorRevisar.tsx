import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useId, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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

/** Fase 6 (US5): las dos pestañas de la bandeja; la de devolver se abre también con ?ver=por-devolver (Agenda). */
const PESTANAS = [
  { valor: 'por-revisar', estado: 'POR_REVISAR', etiqueta: 'Por revisar' },
  { valor: 'por-devolver', estado: 'POR_DEVOLVER', etiqueta: 'Por devolver' },
] as const;
type Pestana = (typeof PESTANAS)[number]['valor'];

export default function AdelantosPorRevisar() {
  const barberia = useBarberia();
  const zona = barberia.data?.zonaHoraria ?? 'America/Lima';
  const [parametros, setParametros] = useSearchParams();
  const pestana: Pestana = parametros.get('ver') === 'por-devolver' ? 'por-devolver' : 'por-revisar';
  const idBase = useId();
  const botones = useRef<(HTMLButtonElement | null)[]>([]);

  const elegir = (valor: Pestana, enfocar = false) => {
    setParametros(valor === 'por-revisar' ? {} : { ver: valor }, { replace: true });
    if (enfocar) botones.current[PESTANAS.findIndex((p) => p.valor === valor)]?.focus();
  };
  // Patrón de pestañas (WAI-ARIA APG): flechas, Inicio y Fin mueven el foco y eligen la pestaña.
  const alTeclear = (evento: KeyboardEvent<HTMLButtonElement>, indice: number) => {
    const destino =
      evento.key === 'ArrowRight'
        ? (indice + 1) % PESTANAS.length
        : evento.key === 'ArrowLeft'
          ? (indice - 1 + PESTANAS.length) % PESTANAS.length
          : evento.key === 'Home'
            ? 0
            : evento.key === 'End'
              ? PESTANAS.length - 1
              : null;
    if (destino === null) return;
    evento.preventDefault();
    elegir(PESTANAS[destino].valor, true);
  };

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Adelantos por revisar' }]}
        titulo="Adelantos por revisar"
        descripcion="Comprueba cada pago en tu aplicación de Yape o Plin, con el código de la reserva y el número de operación, y confírmalo o recházalo. La cita se confirma solo cuando confirmas su pago. En Por devolver están los adelantos de citas canceladas que debes devolver."
      />
      <div role="tablist" aria-label="Adelantos" className={estilos.acciones}>
        {PESTANAS.map((p, indice) => {
          const elegida = p.valor === pestana;
          return (
            <Boton
              key={p.valor}
              ref={(boton: HTMLButtonElement | null) => {
                botones.current[indice] = boton;
              }}
              type="button"
              role="tab"
              id={`${idBase}-pestana-${p.valor}`}
              aria-selected={elegida}
              aria-controls={`${idBase}-panel-${p.valor}`}
              tabIndex={elegida ? 0 : -1}
              variante={elegida ? 'primario' : 'secundario'}
              tamano="sm"
              onClick={() => elegir(p.valor)}
              onKeyDown={(evento) => alTeclear(evento, indice)}
            >
              {p.etiqueta}
            </Boton>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`${idBase}-panel-${pestana}`}
        aria-labelledby={`${idBase}-pestana-${pestana}`}
        tabIndex={0}
      >
        {pestana === 'por-revisar' ? <PorRevisar zona={zona} /> : <PorDevolver zona={zona} />}
      </div>
    </>
  );
}

/** Pestaña "Por revisar" (fase 4, US3): confirmar o rechazar los pagos registrados. */
function PorRevisar({ zona }: { zona: string }) {
  const bandeja = useQuery({
    queryKey: clavesAdelanto.bandejaDe('POR_REVISAR'),
    queryFn: () => apiAdelanto.porRevisar(),
  });
  const [porConfirmar, setPorConfirmar] = useState<AdelantoEnBandeja | null>(null);
  const [porRechazar, setPorRechazar] = useState<AdelantoEnBandeja | null>(null);

  return (
    <>
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

/**
 * T060 de 008 · Pestaña "Por devolver" (US5-6; FR-022): los adelantos de citas canceladas que la barbería debe
 * devolver. La plataforma no mueve dinero: el propietario devuelve desde su aplicación de Yape o Plin y aquí lo anota,
 * con confirmación. Sin el número de operación ni la captura.
 */
function PorDevolver({ zona }: { zona: string }) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const bandeja = useQuery({
    queryKey: clavesAdelanto.bandejaDe('POR_DEVOLVER'),
    queryFn: () => apiAdelanto.porRevisar('POR_DEVOLVER'),
  });
  const [porMarcar, setPorMarcar] = useState<AdelantoEnBandeja | null>(null);
  const devolver = useMutation({
    mutationFn: (citaId: string) => apiAdelanto.devolver(citaId),
    onSuccess: () => {
      setPorMarcar(null);
      avisar({
        tono: 'exito',
        titulo: 'Adelanto marcado como devuelto',
        descripcion: 'Quedó anotado con la fecha de hoy.',
      });
      void consultas.invalidateQueries({ queryKey: clavesAdelanto.bandeja });
    },
    onError: (error) => {
      setPorMarcar(null);
      avisar({
        tono: 'error',
        titulo: 'No se pudo marcar como devuelto',
        descripcion: mensajeDeError(error),
      });
      void consultas.invalidateQueries({ queryKey: clavesAdelanto.bandeja });
    },
  });

  return (
    <section aria-labelledby="titulo-por-devolver">
      <h2 id="titulo-por-devolver" className="sr-only">
        Adelantos por devolver
      </h2>
      {bandeja.isPending ? (
        <CargandoLista texto="Cargando los adelantos por devolver…" filas={3} />
      ) : bandeja.isError ? (
        <Alerta>{mensajeDeError(bandeja.error)}</Alerta>
      ) : bandeja.data.length === 0 ? (
        <EstadoVacio
          icono="check"
          titulo="No hay adelantos por devolver"
          descripcion="Cuando se cancele con tiempo una cita con su adelanto pagado, aparecerá aquí para que lo devuelvas."
        />
      ) : (
        <ul className={estilos.lista} aria-label="Adelantos por devolver">
          {bandeja.data.map((item) => (
            <li key={item.citaId} className={estilos.elemento}>
              <div className={estilos.elementoTextos}>
                <span className={estilos.elementoNombre}>{item.cliente}</span>
                <span className={estilos.elementoDetalle}>
                  {item.servicio} · {item.barbero} · {fechaDeBarberia(item.inicio, zona)},{' '}
                  {horaDeBarberia(item.inicio, zona)}
                </span>
                <span className={estilos.elementoDetalle}>
                  Adelanto {soles(item.adelanto.montoCentimos)} · código {item.adelanto.codigo}
                </span>
              </div>
              <div className={estilos.acciones}>
                <EtiquetaEstado tono="aviso">Por devolver</EtiquetaEstado>
                <Boton type="button" tamano="sm" icono="check" onClick={() => setPorMarcar(item)}>
                  Marcar devuelto<span className="sr-only"> el adelanto de {item.cliente}</span>
                </Boton>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ModalConfirmacion
        abierto={porMarcar !== null}
        onAbiertoCambia={(abierto) => !abierto && setPorMarcar(null)}
        titulo="¿Marcar el adelanto como devuelto?"
        descripcion={
          porMarcar ? (
            <>
              Márcalo solo si ya le devolviste {soles(porMarcar.adelanto.montoCentimos)} a {porMarcar.cliente}{' '}
              desde tu aplicación de Yape o Plin (código {porMarcar.adelanto.codigo}). La plataforma no mueve
              el dinero: solo lo anota.
            </>
          ) : null
        }
        textoConfirmar="Marcar devuelto"
        variante="primario"
        cargando={devolver.isPending}
        onConfirmar={() => porMarcar && devolver.mutate(porMarcar.citaId)}
      />
    </section>
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
