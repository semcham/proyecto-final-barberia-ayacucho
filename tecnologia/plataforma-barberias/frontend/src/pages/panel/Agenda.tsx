import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { ConfirmarCancelacion } from '../../components/app/ConfirmarCancelacion';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import {
  Alerta,
  Boton,
  clasesBoton,
  EstadoVacio,
  EtiquetaEstado,
  Tarjeta,
  type TonoEtiqueta,
  useAvisos,
} from '../../components/ui';
import {
  ETIQUETA_HORA_BARBERIA,
  fechaDeBarberia,
  fechaIsoDeBarberia,
  horaDeBarberia,
} from '../../hora-barberia';
import { Cargando } from './Cargando';
import { BuscadorClientes, type ClienteResumen, FormularioClientePresencial } from './Clientes';
import { mensajeDeError, useZonaBarberia } from './datos-barberia';
import estilos from './Panel.module.css';

type Agenda = components['schemas']['Agenda'];
type CitaAgenda = components['schemas']['CitaAgenda'];
type Barbero = components['schemas']['Barbero'];
type Servicio = components['schemas']['Servicio'];
type HorariosLibres = components['schemas']['HorariosLibres'];
type EstadoCita = components['schemas']['EstadoCita'];

const ESTADO: Record<EstadoCita, { texto: string; tono: TonoEtiqueta }> = {
  PENDIENTE: { texto: 'Pendiente', tono: 'aviso' },
  CONFIRMADA: { texto: 'Confirmada', tono: 'acento' },
  COMPLETADA: { texto: 'Completada', tono: 'exito' },
  NO_ASISTIO: { texto: 'No asistió', tono: 'aviso' },
  CANCELADA: { texto: 'Cancelada', tono: 'neutro' },
};

/**
 * Agenda del día (HU14, RF16; HU16, RF15). Lista por fecha (primera línea de corte, sin calendario). El
 * propietario ve toda la barbería y filtra por barbero; el barbero ve la suya. Las acciones de estado
 * aparecen desde la hora de inicio de la cita. El propietario registra citas presenciales.
 */
export default function Agenda() {
  const { usuario } = useSesion();
  const zona = useZonaBarberia();
  const avisar = useAvisos();
  const consultas = useQueryClient();
  const esPropietario = usuario?.rol === 'PROPIETARIO';
  const [fecha, setFecha] = useState(() => fechaIsoDeBarberia(new Date(), zona));
  const [barbero, setBarbero] = useState('');
  const [presencial, setPresencial] = useState(false);
  // "Ahora" se actualiza cada minuto: las acciones de estado aparecen solas cuando llega la hora de la cita.
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const intervalo = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => window.clearInterval(intervalo);
  }, []);

  const agenda = useQuery({
    queryKey: ['agenda', fecha, barbero],
    queryFn: () =>
      llamarApi<Agenda>(`/agenda?${new URLSearchParams({ fecha, ...(barbero && { barbero }) })}`),
    enabled: /^\d{4}-\d{2}-\d{2}$/.test(fecha),
  });
  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
    enabled: esPropietario,
  });

  const cambiarEstado = useMutation({
    mutationFn: ({ cita, estado }: { cita: CitaAgenda; estado: 'COMPLETADA' | 'NO_ASISTIO' }) =>
      llamarApi(`/citas/${cita.id}/estado`, { metodo: 'POST', cuerpo: { estado } }),
    onSuccess: (_respuesta, { estado }) => {
      avisar({
        tono: 'exito',
        titulo: estado === 'COMPLETADA' ? 'Cita completada' : 'Marcada como no asistió',
      });
      void consultas.invalidateQueries({ queryKey: ['agenda'] });
    },
    onError: (error) => {
      avisar({ tono: 'error', titulo: 'No se pudo cambiar el estado', descripcion: mensajeDeError(error) });
      void consultas.invalidateQueries({ queryKey: ['agenda'] });
    },
  });

  // Cancelación del propietario (RF14): cualquier cita activa, nunca tardía para el cliente.
  const [porCancelar, setPorCancelar] = useState<CitaAgenda | null>(null);
  const cancelar = useMutation({
    mutationFn: (cita: CitaAgenda) => llamarApi(`/citas/${cita.id}/cancelar`, { metodo: 'POST' }),
    onSuccess: () => {
      setPorCancelar(null);
      avisar({ tono: 'exito', titulo: 'Cita cancelada', descripcion: 'El horario quedó libre.' });
      void consultas.invalidateQueries({ queryKey: ['agenda'] });
      void consultas.invalidateQueries({ queryKey: ['horarios-panel'] });
    },
    onError: (error) => {
      setPorCancelar(null);
      avisar({ tono: 'error', titulo: 'No se pudo cancelar la cita', descripcion: mensajeDeError(error) });
      void consultas.invalidateQueries({ queryKey: ['agenda'] });
    },
  });

  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Inicio', a: '/app' }, { etiqueta: 'Agenda' }]}
        titulo="Agenda"
        descripcion={`Las citas del día, en ${ETIQUETA_HORA_BARBERIA}.`}
        acciones={
          esPropietario && (
            <Boton type="button" icono="mas" onClick={() => setPresencial((abierto) => !abierto)}>
              Cita presencial
            </Boton>
          )
        }
      />
      <div className={estilos.secciones}>
        {presencial && esPropietario && (
          <CitaPresencial fecha={fecha} zona={zona} onCerrar={() => setPresencial(false)} />
        )}
        <div className={estilos.fila}>
          <div className="campo">
            <label htmlFor="agenda-fecha" className="campo__etiqueta">
              Fecha
            </label>
            <input
              id="agenda-fecha"
              type="date"
              className="entrada"
              value={fecha}
              onChange={(evento) => setFecha(evento.target.value)}
            />
          </div>
          {esPropietario && (
            <div className="campo">
              <label htmlFor="agenda-barbero" className="campo__etiqueta">
                Barbero
              </label>
              <select
                id="agenda-barbero"
                className="entrada"
                value={barbero}
                onChange={(evento) => setBarbero(evento.target.value)}
              >
                <option value="">Todos los barberos</option>
                {(barberos.data ?? []).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {porCancelar && (
          <ConfirmarCancelacion
            cita={porCancelar}
            zona={zona}
            comoCliente={false}
            cargando={cancelar.isPending}
            onConfirmar={() => cancelar.mutate(porCancelar)}
            onCerrar={() => setPorCancelar(null)}
          />
        )}
        <section aria-label="Citas del día">
          {agenda.isPending ? (
            <Cargando />
          ) : agenda.isError ? (
            <Alerta>
              {agenda.error instanceof ApiError && agenda.error.estado === 403 && !esPropietario
                ? 'Tu usuario no está vinculado a un barbero. Pide al propietario que te vincule en Barberos.'
                : mensajeDeError(agenda.error)}
            </Alerta>
          ) : agenda.data.citas.length === 0 ? (
            <EstadoVacio
              icono="calendario"
              titulo="Sin citas este día"
              descripcion={fechaDeBarberia(`${fecha}T12:00:00Z`, zona)}
              accion={
                esPropietario &&
                !presencial && (
                  <Boton type="button" variante="secundario" icono="mas" onClick={() => setPresencial(true)}>
                    Registrar cita presencial
                  </Boton>
                )
              }
            />
          ) : (
            <ul className={estilos.lista}>
              {agenda.data.citas.map((cita) => {
                const llego = ahora >= Date.parse(cita.inicio);
                return (
                  <li key={cita.id} className={estilos.elemento}>
                    <div className={estilos.elementoTextos}>
                      <span className={estilos.elementoNombre}>
                        {horaDeBarberia(cita.inicio, zona)} – {horaDeBarberia(cita.fin, zona)} ·{' '}
                        <span>{cita.cliente.nombre}</span>
                      </span>
                      <span className={estilos.elementoDetalle}>
                        {cita.servicio} · {cita.barbero} · {cita.cliente.telefono}
                        {cita.origen === 'PRESENCIAL' && ' · Presencial'}
                      </span>
                    </div>
                    <div className={estilos.acciones}>
                      <EtiquetaEstado tono={ESTADO[cita.estado].tono}>
                        {ESTADO[cita.estado].texto}
                      </EtiquetaEstado>
                      {cita.enConflicto && <EtiquetaEstado tono="error">En conflicto</EtiquetaEstado>}
                      {cita.cancelacionTardia && (
                        <EtiquetaEstado tono="aviso">Cancelación tardía</EtiquetaEstado>
                      )}
                      {cita.estado === 'CONFIRMADA' && llego && (
                        <>
                          <Boton
                            type="button"
                            tamano="sm"
                            onClick={() => cambiarEstado.mutate({ cita, estado: 'COMPLETADA' })}
                          >
                            Completar
                          </Boton>
                          <Boton
                            type="button"
                            variante="secundario"
                            tamano="sm"
                            onClick={() => cambiarEstado.mutate({ cita, estado: 'NO_ASISTIO' })}
                          >
                            No asistió
                          </Boton>
                        </>
                      )}
                      {esPropietario && (cita.estado === 'CONFIRMADA' || cita.estado === 'PENDIENTE') && (
                        <Boton
                          type="button"
                          variante="peligro"
                          tamano="sm"
                          onClick={() => setPorCancelar(cita)}
                        >
                          Cancelar
                        </Boton>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

/** Registro de una cita presencial (HU15): cliente (buscado o nuevo), servicio, barbero y hora libre. */
function CitaPresencial({ fecha, zona, onCerrar }: { fecha: string; zona: string; onCerrar: () => void }) {
  const [cliente, setCliente] = useState<ClienteResumen | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [servicioId, setServicioId] = useState('');
  const [barberoId, setBarberoId] = useState('');
  const [inicio, setInicio] = useState<string | null>(null);

  const servicios = useQuery({
    queryKey: clavesConsulta.servicios,
    queryFn: () => llamarApi<Servicio[]>('/servicios'),
  });
  const barberos = useQuery({
    queryKey: clavesConsulta.barberos,
    queryFn: () => llamarApi<Barbero[]>('/barberos'),
  });
  const horarios = useQuery({
    queryKey: ['horarios-panel', servicioId, fecha],
    queryFn: () =>
      llamarApi<HorariosLibres>(`/horarios?${new URLSearchParams({ servicio: servicioId, fecha })}`),
    enabled: servicioId !== '',
  });

  const horas = (horarios.data?.horas ?? []).filter((h) => !barberoId || h.barberoIds.includes(barberoId));
  const hora = horas.find((h) => h.inicio === inicio);
  const nombreBarbero = new Map((barberos.data ?? []).map((b) => [b.id, b.nombre]));

  return (
    <Tarjeta
      titulo="Nueva cita presencial"
      icono="calendario"
      acciones={
        <Boton type="button" variante="fantasma" tamano="sm" onClick={onCerrar}>
          Cerrar
        </Boton>
      }
    >
      <div className={estilos.formulario}>
        {cliente ? (
          <p className={estilos.enlace}>
            <span>
              Cliente: <strong>{cliente.nombre}</strong> · {cliente.telefono}
            </span>
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setCliente(null)}>
              Cambiar
            </Boton>
          </p>
        ) : (
          <>
            <BuscadorClientes etiqueta="Buscar cliente" onElegir={setCliente} />
            <Boton type="button" variante="fantasma" tamano="sm" onClick={() => setNuevo((v) => !v)}>
              {nuevo ? 'Ocultar el alta de cliente' : '¿No está registrado? Regístralo aquí'}
            </Boton>
            {nuevo && <FormularioClientePresencial onRegistrado={setCliente} />}
          </>
        )}

        <div className={estilos.fila}>
          <div className="campo">
            <label htmlFor="presencial-servicio" className="campo__etiqueta">
              Servicio
            </label>
            <select
              id="presencial-servicio"
              className="entrada"
              value={servicioId}
              onChange={(evento) => {
                setServicioId(evento.target.value);
                setInicio(null);
              }}
            >
              <option value="">Elige un servicio</option>
              {(servicios.data ?? [])
                .filter((s) => s.activo)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nombre}
                  </option>
                ))}
            </select>
          </div>
          <div className="campo">
            <label htmlFor="presencial-barbero" className="campo__etiqueta">
              Barbero de la cita
            </label>
            <select
              id="presencial-barbero"
              className="entrada"
              value={barberoId}
              onChange={(evento) => {
                setBarberoId(evento.target.value);
                setInicio(null);
              }}
            >
              <option value="">Cualquiera libre</option>
              {(barberos.data ?? [])
                .filter((b) => b.activo && (!servicioId || b.servicioIds.includes(servicioId)))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nombre}
                  </option>
                ))}
            </select>
          </div>
        </div>

        {servicioId &&
          (horarios.isPending ? (
            <Cargando />
          ) : horarios.isError ? (
            <Alerta>{mensajeDeError(horarios.error)}</Alerta>
          ) : horas.length === 0 ? (
            <EstadoVacio icono="calendario" titulo="No hay horas libres ese día" />
          ) : (
            <div role="group" aria-label="Horas libres" className={estilos.acciones}>
              {horas.map((h) => (
                <button
                  key={h.inicio}
                  type="button"
                  className={clasesBoton({
                    variante: h.inicio === inicio ? 'primario' : 'secundario',
                    tamano: 'sm',
                  })}
                  aria-pressed={h.inicio === inicio}
                  onClick={() => setInicio(h.inicio)}
                >
                  {horaDeBarberia(h.inicio, zona)}
                </button>
              ))}
            </div>
          ))}

        {cliente && hora && (
          // Con `key`, otra selección monta una confirmación nueva con otra Idempotency-Key (R09).
          <ConfirmarPresencial
            key={`${cliente.id}|${servicioId}|${barberoId}|${hora.inicio}`}
            cliente={cliente}
            servicioId={servicioId}
            barberoId={barberoId || hora.barberoIds[0]}
            nombreBarbero={nombreBarbero.get(barberoId || hora.barberoIds[0]) ?? ''}
            inicio={hora.inicio}
            zona={zona}
            onHecho={onCerrar}
          />
        )}
      </div>
    </Tarjeta>
  );
}

function ConfirmarPresencial(props: {
  cliente: ClienteResumen;
  servicioId: string;
  barberoId: string;
  nombreBarbero: string;
  inicio: string;
  zona: string;
  onHecho: () => void;
}) {
  const avisar = useAvisos();
  const consultas = useQueryClient();
  // Se genera al abrir la confirmación y se reutiliza en los reintentos: el servidor no duplica la cita.
  const [clave] = useState(() => crypto.randomUUID());
  const registrar = useMutation({
    mutationFn: () =>
      llamarApi('/citas', {
        metodo: 'POST',
        cuerpo: {
          servicioId: props.servicioId,
          barberoId: props.barberoId,
          inicio: props.inicio,
          clienteId: props.cliente.id,
        },
        encabezados: { 'Idempotency-Key': clave },
      }),
    onSuccess: () => {
      avisar({ tono: 'exito', titulo: 'Cita registrada', descripcion: props.cliente.nombre });
      void consultas.invalidateQueries({ queryKey: ['agenda'] });
      void consultas.invalidateQueries({ queryKey: ['horarios-panel'] });
      props.onHecho();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.estado === 409) {
        void consultas.invalidateQueries({ queryKey: ['horarios-panel'] });
      }
    },
  });

  return (
    <div className={estilos.formulario}>
      <p className={estilos.aviso}>
        {props.cliente.nombre} con {props.nombreBarbero}, {fechaDeBarberia(props.inicio, props.zona)} a las{' '}
        {horaDeBarberia(props.inicio, props.zona)} ({ETIQUETA_HORA_BARBERIA}).
      </p>
      {registrar.isError && <Alerta>{mensajeDeError(registrar.error)}</Alerta>}
      <div className={estilos.acciones}>
        <Boton
          type="button"
          cargando={registrar.isPending}
          textoCargando="Registrando…"
          onClick={() => registrar.mutate()}
        >
          Registrar cita
        </Boton>
      </div>
    </div>
  );
}
