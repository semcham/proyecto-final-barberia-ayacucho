import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { llamarApi } from '../../api/client';
import {
  apiSolicitudes,
  clavesSolicitudes,
  fechaLarga,
  type FiltroBandeja,
  type SolicitudEnBandeja,
  TEXTO_ESTADO,
  type TipoSolicitud,
} from '../../api/solicitudes-datos';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import estilos from '../../components/datos-personales/DatosPersonales.module.css';
import { TONO_ESTADO } from '../../components/datos-personales/MisSolicitudes';
import { Icono } from '../../components/Icono';
import { Alerta, Boton, EstadoVacio, EtiquetaEstado } from '../../components/ui';
import modal from '../../components/ui/Modal.module.css';
import { CargandoLista } from './Cargando';
import { mensajeDeError } from './datos-barberia';

// T015 de 007 · Bandeja de solicitudes sobre datos personales del propietario (/app/solicitudes-datos; US1, FR-003 a
// FR-008). Ve las de su barbería con el titular, el plazo (10 días hábiles) y si están vencidas; las atiende a mano:
// inicia la atención, atiende con una respuesta (qué hizo y qué se conserva) o rechaza con un motivo. El sistema no
// borra ni exporta nada. También registra una solicitud en nombre de un cliente que la pidió por otro medio.

const FILTROS: { valor: FiltroBandeja; etiqueta: string; vacio: string }[] = [
  { valor: 'ABIERTAS', etiqueta: 'Abiertas', vacio: 'No hay solicitudes abiertas' },
  { valor: 'RECIBIDA', etiqueta: 'Recibidas', vacio: 'No hay solicitudes recibidas' },
  { valor: 'EN_ATENCION', etiqueta: 'En atención', vacio: 'No hay solicitudes en atención' },
  { valor: 'ATENDIDA', etiqueta: 'Atendidas', vacio: 'No hay solicitudes atendidas' },
  { valor: 'RECHAZADA', etiqueta: 'Rechazadas', vacio: 'No hay solicitudes rechazadas' },
];

const TIPO_EN_BANDEJA: Record<TipoSolicitud, string> = {
  ACCESO: 'Acceso',
  RECTIFICACION: 'Rectificación',
  ELIMINACION: 'Eliminación',
};

type Mensaje = { tono: 'error' | 'exito'; texto: string } | null;
type Cierre = { solicitud: SolicitudEnBandeja; resultado: 'ATENDIDA' | 'RECHAZADA' } | null;

export default function SolicitudesDatos() {
  const consultas = useQueryClient();
  const idFiltro = useId();
  const [filtro, setFiltro] = useState<FiltroBandeja>('ABIERTAS');
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [cierre, setCierre] = useState<Cierre>(null);
  const bandeja = useQuery({
    queryKey: clavesSolicitudes.bandeja(filtro),
    queryFn: () => apiSolicitudes.bandeja(filtro),
  });
  const refrescar = () => void consultas.invalidateQueries({ queryKey: clavesSolicitudes.todas });

  const iniciar = useMutation({
    mutationFn: (id: string) => apiSolicitudes.iniciar(id),
    onSuccess: () => {
      setMensaje({ tono: 'exito', texto: 'La solicitud quedó en atención.' });
      refrescar();
    },
    onError: (error) => {
      setMensaje({ tono: 'error', texto: mensajeDeError(error) });
      refrescar();
    },
  });

  const vacio = FILTROS.find((f) => f.valor === filtro)?.vacio ?? 'No hay solicitudes';

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Solicitudes de datos' }]}
        titulo="Solicitudes de datos"
        descripcion="Pedidos de acceso, corrección o eliminación de datos personales de tus clientes y barberos. Atiéndelos a mano y deja la respuesta: qué hiciste y qué se conserva por obligación. El plazo interno es de 10 días hábiles."
      />
      <div className={estilos.seccion}>
        <div className={`campo ${estilos.filtro}`}>
          <label htmlFor={idFiltro} className="campo__etiqueta">
            Estado
          </label>
          <select
            id={idFiltro}
            className="entrada"
            value={filtro}
            onChange={(evento) => {
              setFiltro(evento.target.value as FiltroBandeja);
              setMensaje(null);
            }}
          >
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.etiqueta}
              </option>
            ))}
          </select>
        </div>

        {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

        <section aria-labelledby={`${idFiltro}-titulo`} className={estilos.seccion}>
          <h2 id={`${idFiltro}-titulo`} className="sr-only">
            Solicitudes
          </h2>
          {bandeja.isPending ? (
            <CargandoLista texto="Cargando las solicitudes…" filas={3} />
          ) : bandeja.isError ? (
            <Alerta>No se pudieron cargar las solicitudes. {mensajeDeError(bandeja.error)}</Alerta>
          ) : bandeja.data.length === 0 ? (
            <EstadoVacio icono="escudo" titulo={vacio} />
          ) : (
            <ul className={estilos.lista} aria-label="Solicitudes">
              {bandeja.data.map((s) => (
                <li key={s.id} className={estilos.solicitud}>
                  <div className={estilos.cabecera}>
                    <span className={estilos.nombre}>
                      {s.titular.nombre} · {s.titular.tipo === 'CLIENTE' ? 'Cliente' : 'Barbero'}
                    </span>
                    <span className={estilos.acciones}>
                      <EtiquetaEstado tono={TONO_ESTADO[s.estado]}>{TEXTO_ESTADO[s.estado]}</EtiquetaEstado>
                      {s.vencida && <EtiquetaEstado tono="aviso">Vencida</EtiquetaEstado>}
                    </span>
                  </div>
                  <p className={estilos.dato}>
                    {TIPO_EN_BANDEJA[s.tipo]} · vence el {fechaLarga(s.venceEl)}
                    {s.enNombre ? ' · registrada por la barbería en su nombre' : ''}
                  </p>
                  {s.detalle && <p className={estilos.texto}>Pedido: {s.detalle}</p>}
                  {s.respuesta && <p className={estilos.texto}>Respuesta: {s.respuesta}</p>}
                  {s.motivo && <p className={estilos.texto}>Motivo del rechazo: {s.motivo}</p>}
                  {(s.estado === 'RECIBIDA' || s.estado === 'EN_ATENCION') && (
                    <div className={estilos.acciones}>
                      {s.estado === 'RECIBIDA' && (
                        <Boton
                          type="button"
                          variante="secundario"
                          tamano="sm"
                          cargando={iniciar.isPending && iniciar.variables === s.id}
                          onClick={() => iniciar.mutate(s.id)}
                        >
                          Iniciar atención
                          <span className="sr-only"> de la solicitud de {s.titular.nombre}</span>
                        </Boton>
                      )}
                      <Boton
                        type="button"
                        tamano="sm"
                        icono="check"
                        onClick={() => setCierre({ solicitud: s, resultado: 'ATENDIDA' })}
                      >
                        Atender<span className="sr-only"> la solicitud de {s.titular.nombre}</span>
                      </Boton>
                      <Boton
                        type="button"
                        variante="peligro"
                        tamano="sm"
                        onClick={() => setCierre({ solicitud: s, resultado: 'RECHAZADA' })}
                      >
                        Rechazar<span className="sr-only"> la solicitud de {s.titular.nombre}</span>
                      </Boton>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <RegistrarEnNombre onRegistrada={refrescar} />
      </div>

      <DialogoCierre
        cierre={cierre}
        onCerrar={() => setCierre(null)}
        onHecho={(texto) => {
          setCierre(null);
          setMensaje({ tono: 'exito', texto });
          refrescar();
        }}
      />
    </>
  );
}

const TEXTOS_CIERRE = {
  ATENDIDA: {
    titulo: 'Atender la solicitud',
    etiqueta: 'Respuesta',
    ayuda:
      'Escribe qué hiciste a mano y qué se conserva por obligación (por ejemplo, el consentimiento o la auditoría). El titular la verá. Hasta 1 000 caracteres.',
    error: 'Escribe qué hiciste y qué se conserva por obligación (hasta 1 000 caracteres).',
    boton: 'Marcar como atendida',
    minimo: 1,
    maximo: 1000,
    hecho: 'La solicitud quedó atendida.',
  },
  RECHAZADA: {
    titulo: 'Rechazar la solicitud',
    etiqueta: 'Motivo del rechazo',
    ayuda: 'El titular lo verá. De 5 a 300 caracteres.',
    error: 'Escribe el motivo del rechazo, de 5 a 300 caracteres.',
    boton: 'Rechazar solicitud',
    minimo: 5,
    maximo: 300,
    hecho: 'La solicitud quedó rechazada.',
  },
} as const;

function DialogoCierre({
  cierre,
  onCerrar,
  onHecho,
}: {
  cierre: Cierre;
  onCerrar: () => void;
  onHecho: (texto: string) => void;
}) {
  const idTexto = useId();
  const [texto, setTexto] = useState('');
  const [error, setError] = useState<string | null>(null);
  const resultado = cierre?.resultado ?? 'ATENDIDA';
  const textos = TEXTOS_CIERRE[resultado];

  const cerrar = useMutation({
    mutationFn: ({ id, valor }: { id: string; valor: string }) =>
      apiSolicitudes.cerrar(
        id,
        resultado === 'ATENDIDA' ? { resultado, respuesta: valor } : { resultado, motivo: valor },
      ),
    onSuccess: () => {
      limpiar();
      onHecho(textos.hecho);
    },
  });

  const limpiar = () => {
    setTexto('');
    setError(null);
    cerrar.reset();
  };

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const valor = texto.trim();
    if (valor.length < textos.minimo || valor.length > textos.maximo) {
      setError(textos.error);
      return;
    }
    setError(null);
    if (cierre) cerrar.mutate({ id: cierre.solicitud.id, valor });
  };

  return (
    <Dialog.Root
      open={cierre !== null}
      onOpenChange={(abierto) => {
        if (!abierto && !cerrar.isPending) {
          limpiar();
          onCerrar();
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={modal.velo} />
        <Dialog.Content className={modal.modal}>
          <div className={modal.cabecera}>
            <span className={`${modal.icono} ${resultado === 'RECHAZADA' ? modal.iconoPeligro : ''}`}>
              <Icono nombre={resultado === 'RECHAZADA' ? 'alerta' : 'check'} />
            </span>
            <div>
              <Dialog.Title className={modal.titulo}>{textos.titulo}</Dialog.Title>
              <Dialog.Description className={modal.descripcion}>
                {cierre
                  ? `${TIPO_EN_BANDEJA[cierre.solicitud.tipo]} de ${cierre.solicitud.titular.nombre}. El sistema no borra ni exporta nada: solo registra lo que escribas.`
                  : null}
              </Dialog.Description>
            </div>
          </div>
          <form onSubmit={enviar} noValidate className={estilos.formulario}>
            <div className="campo">
              <label htmlFor={idTexto} className="campo__etiqueta">
                {textos.etiqueta}
              </label>
              <textarea
                id={idTexto}
                className="entrada"
                rows={4}
                maxLength={textos.maximo}
                value={texto}
                onChange={(evento) => setTexto(evento.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${idTexto}-error` : `${idTexto}-ayuda`}
              />
              <p id={`${idTexto}-ayuda`} className="campo__ayuda">
                {textos.ayuda}
              </p>
              {error && (
                <p id={`${idTexto}-error`} className="mensaje-error">
                  <Icono nombre="alerta" tamano={16} />
                  {error}
                </p>
              )}
            </div>
            {cerrar.isError && <Alerta>{mensajeDeError(cerrar.error)}</Alerta>}
            <div className={modal.acciones}>
              <Dialog.Close asChild>
                <Boton type="button" variante="secundario" disabled={cerrar.isPending}>
                  Cancelar
                </Boton>
              </Dialog.Close>
              <Boton
                type="submit"
                variante={resultado === 'RECHAZADA' ? 'peligro' : 'primario'}
                cargando={cerrar.isPending}
              >
                {textos.boton}
              </Boton>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

interface ClienteEncontrado {
  id: string;
  nombre: string;
  telefono: string;
  origen: 'EN_LINEA' | 'PRESENCIAL';
}

/** FR-003: el propietario registra una solicitud por un cliente de su barbería que la pidió por otro medio. */
function RegistrarEnNombre({ onRegistrada }: { onRegistrada: () => void }) {
  const id = useId();
  const [busqueda, setBusqueda] = useState('');
  const [clientes, setClientes] = useState<ClienteEncontrado[] | null>(null);
  const [cliente, setCliente] = useState<ClienteEncontrado | null>(null);
  const [tipo, setTipo] = useState<TipoSolicitud | null>(null);
  const [detalle, setDetalle] = useState('');
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [buscando, setBuscando] = useState(false);

  const buscar = async () => {
    setMensaje(null);
    const texto = busqueda.trim();
    if (texto.length < 2) {
      setMensaje({ tono: 'error', texto: 'Escribe al menos 2 letras o números para buscar.' });
      return;
    }
    setBuscando(true);
    try {
      setClientes(await llamarApi<ClienteEncontrado[]>(`/clientes?buscar=${encodeURIComponent(texto)}`));
      setCliente(null);
    } catch (error) {
      setMensaje({ tono: 'error', texto: mensajeDeError(error) });
    } finally {
      setBuscando(false);
    }
  };

  const registrar = useMutation({
    mutationFn: apiSolicitudes.registrarEnNombre,
    onSuccess: () => {
      setMensaje({
        tono: 'exito',
        texto: `Registramos la solicitud en nombre de ${cliente?.nombre ?? 'el cliente'}.`,
      });
      setTipo(null);
      setDetalle('');
      onRegistrada();
    },
    onError: (error) => setMensaje({ tono: 'error', texto: mensajeDeError(error) }),
  });

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    setMensaje(null);
    if (!cliente || !tipo) {
      setMensaje({ tono: 'error', texto: 'Elige el cliente y qué pide.' });
      return;
    }
    const texto = detalle.trim();
    if (tipo === 'RECTIFICACION' && !texto) {
      setMensaje({ tono: 'error', texto: 'Escribe qué dato quiere corregir y cómo.' });
      return;
    }
    registrar.mutate(
      texto ? { tipo, detalle: texto, clienteId: cliente.id } : { tipo, clienteId: cliente.id },
    );
  };

  return (
    <section aria-labelledby={`${id}-titulo`} className={estilos.seccion}>
      <h2 id={`${id}-titulo`}>Registrar en nombre de un cliente</h2>
      <p className={estilos.dato}>
        Si un cliente te lo pidió por otro medio (por ejemplo, en la barbería), registra aquí su solicitud.
        Quedará anotado que la registraste tú.
      </p>
      <form className={estilos.formulario} onSubmit={enviar} noValidate>
        <div className="campo">
          <label htmlFor={`${id}-buscar`} className="campo__etiqueta">
            Buscar cliente
          </label>
          <div className={estilos.acciones}>
            <input
              id={`${id}-buscar`}
              className="entrada"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              onKeyDown={(evento) => {
                if (evento.key === 'Enter') {
                  evento.preventDefault();
                  void buscar();
                }
              }}
            />
            <Boton
              type="button"
              variante="secundario"
              icono="buscar"
              cargando={buscando}
              onClick={() => void buscar()}
            >
              Buscar
            </Boton>
          </div>
        </div>

        {clientes !== null &&
          (clientes.length === 0 ? (
            <p className={estilos.dato}>No encontramos clientes con ese nombre o teléfono.</p>
          ) : (
            <fieldset className={estilos.grupo}>
              <legend>Cliente</legend>
              {clientes.map((c) => (
                <label key={c.id} className={`casilla ${estilos.opcion}`}>
                  <input
                    type="radio"
                    name={`${id}-cliente`}
                    checked={cliente?.id === c.id}
                    onChange={() => setCliente(c)}
                  />
                  <span>
                    {c.nombre} · {c.telefono}
                  </span>
                </label>
              ))}
            </fieldset>
          ))}

        <fieldset className={estilos.grupo}>
          <legend>¿Qué pide?</legend>
          <div className={estilos.opciones}>
            {(['ACCESO', 'RECTIFICACION', 'ELIMINACION'] as const).map((t) => (
              <label key={t} className={`casilla ${estilos.opcion}`}>
                <input type="radio" name={`${id}-tipo`} checked={tipo === t} onChange={() => setTipo(t)} />
                <span>{TIPO_EN_BANDEJA[t]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="campo">
          <label htmlFor={`${id}-detalle`} className="campo__etiqueta">
            Detalle {tipo === 'RECTIFICACION' ? '(qué dato y cómo corregirlo)' : '(opcional)'}
          </label>
          <textarea
            id={`${id}-detalle`}
            className="entrada"
            rows={3}
            maxLength={500}
            value={detalle}
            onChange={(evento) => setDetalle(evento.target.value)}
          />
        </div>

        {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

        <div className={estilos.acciones}>
          <Boton type="submit" cargando={registrar.isPending}>
            Registrar solicitud
          </Boton>
        </div>
      </form>
    </section>
  );
}
