import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError, llamarApi } from '../../api/client';
import type { components as Esquemas002 } from '../../api/schema-002';
import type { components } from '../../api/schema-004';
import { ConfirmarCancelacion } from '../../components/app/ConfirmarCancelacion';
import { SelectorDeHora } from '../../components/app/SelectorDeHora';
import { Logo } from '../../components/Logo';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { Tarjeta } from '../../components/ui/Tarjeta';
import {
  ETIQUETA_HORA_BARBERIA,
  fechaDeBarberia,
  fechaIsoDeBarberia,
  horaConEtiqueta,
  horaDeBarberia,
  sumarDiasIso,
} from '../../hora-barberia';
import { HORIZONTE_RESERVA_DIAS } from '../../legal';
import estilos from './Enlace.module.css';

type EnlaceAccion = components['schemas']['EnlaceAccion'];
type ResultadoAccion = components['schemas']['ResultadoAccion'];
type HorariosLibres = Esquemas002['schemas']['HorariosLibres'];

const mensajeDe = (error: unknown) =>
  error instanceof ApiError ? error.message : 'No pudimos conectar con el servidor. Intenta de nuevo.';
const esNoValido = (error: unknown) => error instanceof ApiError && error.codigo === 'ENLACE_NO_VALIDO';
const segundosDeEspera = (error: unknown): number | null => {
  if (!(error instanceof ApiError) || error.estado !== 429) return null;
  const valor = error.detalles.find((d) => typeof d.reintentarEnSegundos === 'number')?.reintentarEnSegundos;
  return typeof valor === 'number' ? valor : 60;
};

/** El token viaja SOLO en este encabezado: nunca en la ruta ni en la consulta (contracts/enlaces-de-accion.md). */
const conEnlace = (token: string) => ({ encabezados: { 'X-Enlace-Accion': token }, sinRenovar: true });

/**
 * Página del enlace de acción del recordatorio (RF34; research R15; ADR-032), pública y sin sesión: `/e#<token>`.
 * El token llega en el FRAGMENTO de la dirección (el navegador no lo envía al servidor ni en Referer). Se lee una
 * vez y se quita de la dirección al instante; se guarda solo en memoria, nunca en el almacenamiento del navegador.
 * Abrir la página no consume el enlace: solo la acción confirmada lo hace.
 */
export default function Enlace() {
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const [token] = useState(() => decodeURIComponent(ubicacion.hash.replace(/^#/, '')) || null);

  useEffect(() => {
    // Quita el token de la dirección (y del historial: replace) apenas se lee.
    if (ubicacion.hash) navegar(ubicacion.pathname, { replace: true });
  }, [ubicacion.hash, ubicacion.pathname, navegar]);

  const consulta = useQuery({
    queryKey: ['enlace-accion'],
    queryFn: () => llamarApi<EnlaceAccion>('/enlaces/accion', conEnlace(token as string)),
    enabled: token !== null,
    retry: false,
    staleTime: Infinity,
  });

  let contenido: ReactNode;
  if (!token || (consulta.isError && esNoValido(consulta.error))) {
    contenido = <NoValido />;
  } else if (consulta.isPending) {
    contenido = (
      <p aria-busy="true" className={estilos.ayuda}>
        Cargando el enlace…
      </p>
    );
  } else if (consulta.isError) {
    const espera = segundosDeEspera(consulta.error);
    contenido = (
      <>
        <Alerta>
          {espera !== null
            ? `Demasiados intentos desde esta conexión. Vuelve a intentarlo en ${espera} segundos.`
            : mensajeDe(consulta.error)}
        </Alerta>
        {espera === null && (
          <Boton
            type="button"
            variante="secundario"
            icono="recargar"
            cargando={consulta.isFetching}
            textoCargando="Intentando…"
            onClick={() => void consulta.refetch()}
          >
            Intentar de nuevo
          </Boton>
        )}
      </>
    );
  } else {
    contenido = <Accion token={token} datos={consulta.data} />;
  }

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo compacto />
      </header>
      {contenido}
    </main>
  );
}

function NoValido() {
  return (
    <section className={estilos.bloque} aria-labelledby="titulo-no-valido">
      <h1 id="titulo-no-valido">Este enlace ya no es válido</h1>
      <p className={estilos.ayuda}>
        Puede que ya lo hayas usado, que la cita haya cambiado o que haya pasado su hora. Inicia sesión para
        gestionar tus citas.
      </p>
      <Link to="/ingresar" className={clasesBoton({ variante: 'secundario' })}>
        Iniciar sesión
      </Link>
    </section>
  );
}

const TITULOS: Record<EnlaceAccion['accion'], string> = {
  CONFIRMAR: 'Confirma tu asistencia',
  CANCELAR: 'Cancelar tu cita',
  REPROGRAMAR: 'Reprogramar tu cita',
};

/** Los datos mínimos de la cita (FR-013, FR-026) y la acción del enlace. */
function Accion({ token, datos }: { token: string; datos: EnlaceAccion }) {
  const { cita } = datos;
  const zona = cita.zonaHoraria;
  const [hecho, setHecho] = useState<string | null>(null);
  const [noValido, setNoValido] = useState(false);
  if (noValido) return <NoValido />;

  return (
    <section className={estilos.bloque} aria-labelledby="titulo-enlace">
      <p className="antetitulo">{cita.barberia}</p>
      <h1 id="titulo-enlace">{TITULOS[datos.accion]}</h1>
      <Tarjeta titulo="Tu cita" icono="calendario">
        <dl className={estilos.datos}>
          <dt>Servicio</dt>
          <dd>{cita.servicio}</dd>
          <dt>Barbero</dt>
          <dd>{cita.barbero}</dd>
          <dt>Fecha</dt>
          <dd>
            {fechaDeBarberia(cita.inicio, zona)}, {horaConEtiqueta(cita.inicio, zona)}
          </dd>
        </dl>
      </Tarjeta>
      {hecho ? (
        <Alerta tono="exito">{hecho}</Alerta>
      ) : datos.accion === 'CONFIRMAR' ? (
        <Confirmar token={token} onHecho={setHecho} onNoValido={() => setNoValido(true)} />
      ) : datos.accion === 'CANCELAR' ? (
        <Cancelar token={token} datos={datos} onHecho={setHecho} onNoValido={() => setNoValido(true)} />
      ) : (
        <Reprogramar token={token} datos={datos} onHecho={setHecho} onNoValido={() => setNoValido(true)} />
      )}
    </section>
  );
}

interface PropiedadesAccion {
  token: string;
  onHecho: (mensaje: string) => void;
  onNoValido: () => void;
}

function useAccion(
  ruta: 'confirmar' | 'cancelar' | 'reprogramar',
  { token, onHecho, onNoValido }: PropiedadesAccion,
  mensaje: (resultado: ResultadoAccion) => string,
  alFallar?: (error: unknown) => void,
) {
  return useMutation({
    mutationFn: (cuerpo: object = {}) =>
      llamarApi<ResultadoAccion>(`/enlaces/accion/${ruta}`, { ...conEnlace(token), metodo: 'POST', cuerpo }),
    onSuccess: (resultado) => onHecho(mensaje(resultado)),
    onError: (error) => {
      if (esNoValido(error)) onNoValido();
      else alFallar?.(error);
    },
  });
}

function ErrorDeAccion({ error }: { error: unknown }) {
  if (!error || esNoValido(error)) return null;
  const espera = segundosDeEspera(error);
  return (
    <Alerta>
      {espera !== null
        ? `Demasiados intentos desde esta conexión. Vuelve a intentarlo en ${espera} segundos.`
        : mensajeDe(error)}
    </Alerta>
  );
}

function Confirmar(props: PropiedadesAccion) {
  const confirmar = useAccion('confirmar', props, () => '¡Listo! Confirmaste tu asistencia. Te esperamos.');
  return (
    <div className={estilos.acciones}>
      <ErrorDeAccion error={confirmar.error} />
      <Boton
        type="button"
        icono="calendarioCheck"
        cargando={confirmar.isPending}
        textoCargando="Confirmando…"
        onClick={() => confirmar.mutate({})}
      >
        Confirmo mi asistencia
      </Boton>
    </div>
  );
}

function Cancelar(props: PropiedadesAccion & { datos: EnlaceAccion }) {
  const [preguntando, setPreguntando] = useState(false);
  const { cita } = props.datos;
  const cancelar = useAccion('cancelar', props, (resultado) =>
    resultado.cita.cancelacionTardia
      ? 'Tu cita fue cancelada. Quedó como cancelación tardía.'
      : 'Tu cita fue cancelada. El horario quedó libre.',
  );
  return (
    <div className={estilos.acciones}>
      <ErrorDeAccion error={cancelar.error} />
      <Boton type="button" variante="peligro" onClick={() => setPreguntando(true)}>
        Cancelar la cita
      </Boton>
      {preguntando && (
        <ConfirmarCancelacion
          cita={{
            inicio: cita.inicio,
            servicio: cita.servicio,
            cancelacionTardiaDesde: cita.cancelacionTardiaDesde,
          }}
          zona={cita.zonaHoraria}
          comoCliente
          cargando={cancelar.isPending}
          onConfirmar={() => cancelar.mutate({}, { onSettled: () => setPreguntando(false) })}
          onCerrar={() => setPreguntando(false)}
        />
      )}
    </div>
  );
}

/** Reprogramar con la selección de hora del catálogo (SelectorDeHora) y los horarios públicos de la barbería. */
function Reprogramar(props: PropiedadesAccion & { datos: EnlaceAccion }) {
  const { cita, reprogramacion } = props.datos;
  const zona = cita.zonaHoraria;
  const hoy = fechaIsoDeBarberia(new Date(), zona);
  const diaDeLaCita = fechaIsoDeBarberia(new Date(cita.inicio), zona);
  const [fecha, setFecha] = useState(diaDeLaCita >= hoy ? diaDeLaCita : hoy);
  const [inicio, setInicio] = useState<string | null>(null);

  const horarios = useQuery({
    queryKey: ['enlace-horarios', reprogramacion?.slug, reprogramacion?.servicioId, fecha],
    queryFn: () =>
      llamarApi<HorariosLibres>(
        `/publico/${encodeURIComponent(reprogramacion?.slug ?? '')}/horarios?${new URLSearchParams({
          servicio: reprogramacion?.servicioId ?? '',
          fecha,
        })}`,
        { sinRenovar: true },
      ),
    enabled: reprogramacion !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(fecha),
  });
  const barberoId = reprogramacion?.barberoId;
  const horas = (horarios.data?.horas ?? []).filter((h) => !barberoId || h.barberoIds.includes(barberoId));
  const hora = horas.find((h) => h.inicio === inicio);

  const reprogramar = useAccion(
    'reprogramar',
    props,
    (resultado) =>
      `Tu cita quedó para el ${fechaDeBarberia(resultado.cita.inicio, zona)} a las ${horaConEtiqueta(resultado.cita.inicio, zona)}.`,
    (error) => {
      // La hora se ocupó mientras tanto: se vuelven a pedir las horas libres. El enlace sigue sin usar.
      if (error instanceof ApiError && error.estado === 409) {
        setInicio(null);
        void horarios.refetch();
      }
    },
  );

  if (!reprogramacion) {
    return (
      <Alerta>La barbería no está recibiendo reservas por ahora, así que no se puede reprogramar.</Alerta>
    );
  }
  return (
    <div className={estilos.acciones}>
      <div className="campo">
        <label htmlFor="enlace-fecha" className="campo__etiqueta">
          Nueva fecha
        </label>
        <input
          id="enlace-fecha"
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
      <p className={estilos.ayuda}>Horas en {ETIQUETA_HORA_BARBERIA}.</p>
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
      <ErrorDeAccion error={reprogramar.error} />
      <Boton
        type="button"
        disabled={!hora}
        cargando={reprogramar.isPending}
        textoCargando="Reprogramando…"
        onClick={() => hora && reprogramar.mutate({ inicio: hora.inicio, barberoId })}
      >
        {hora ? `Reprogramar a las ${horaDeBarberia(hora.inicio, zona)}` : 'Elige una hora'}
      </Boton>
    </div>
  );
}
