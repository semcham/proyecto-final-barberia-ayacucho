import { useMutation } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  apiAsistente,
  type Intervencion,
  MAXIMO_CARACTERES,
  MAXIMO_INTERVENCIONES,
  type RespuestaAsistente,
} from '../../api/asistente';
import { ApiError } from '../../api/client';
import { useSesion } from '../../auth/SesionProvider';
import { Logo } from '../../components/Logo';
import { Alerta, Boton, clasesBoton } from '../../components/ui';
import panel from '../panel/Panel.module.css';
import estilos from './Asistente.module.css';

// T045 de 005 · Asistente del cliente (/asistente; US1, FR-007, FR-008, FR-012, FR-013 y FR-018). Preguntas en
// lenguaje natural sobre los servicios, los barberos y los horarios libres de SU barbería. Las respuestas las compone
// el servidor con los datos de la barbería; aquí solo se muestran. La conversación vive solo en memoria: al recargar
// empieza de nuevo y se envían como mucho las últimas 6 intervenciones. El asistente nunca reserva: cada hora libre
// lleva a Reservar con todo elegido.

interface Turno {
  de: Intervencion['de'];
  texto: string;
  respuesta?: RespuestaAsistente;
}

type Hora = NonNullable<
  Extract<NonNullable<RespuestaAsistente['datos']>, { tipo: 'HORARIOS' }>['horas']
>[number];

/** "15 de noviembre de 2026, 00:00" de un instante ISO que ya viene con el desplazamiento de la barbería. */
function momentoLocal(iso: string): string {
  const [anio, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  const fecha = new Intl.DateTimeFormat('es-PE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(anio, mes - 1, dia)));
  return `${fecha}, ${iso.slice(11, 16)}`;
}

/** El aviso de un error de la API: la cuota agotada (con su reinicio) o "no disponible", con la alternativa. */
function avisoDe(error: unknown): { mensaje: string; reinicio?: string; reservar: boolean } {
  if (!(error instanceof ApiError)) {
    return { mensaje: 'No pudimos conectar con el servidor. Intenta de nuevo.', reservar: false };
  }
  const detalle = error.detalles[0] as { reiniciaEn?: unknown; alternativa?: { tipo?: unknown } } | undefined;
  if (error.codigo === 'CUOTA_ASISTENTE_AGOTADA') {
    const reinicio = typeof detalle?.reiniciaEn === 'string' ? momentoLocal(detalle.reiniciaEn) : undefined;
    return { mensaje: error.message, reinicio, reservar: true };
  }
  if (error.codigo === 'ASISTENTE_NO_DISPONIBLE') {
    return { mensaje: error.message, reservar: detalle?.alternativa?.tipo === 'RESERVAR' };
  }
  return { mensaje: error.message, reservar: false };
}

function EnlaceDeHora({ hora }: { hora: Hora }) {
  if (!hora.enlace) return <span>{hora.inicio.slice(11, 16)}</span>;
  const barberoId = new URL(hora.enlace, 'http://interfaz').searchParams.get('barbero');
  const barbero = hora.barberos.find((b) => b.barberoId === barberoId)?.nombre;
  return (
    <Link to={hora.enlace} className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
      Reservar a las {hora.inicio.slice(11, 16)}
      {barbero ? ` con ${barbero}` : ''}
    </Link>
  );
}

function Respuesta({ respuesta }: { respuesta: RespuestaAsistente }) {
  const datos = respuesta.datos;
  return (
    <>
      <p>{respuesta.texto}</p>
      {datos?.tipo === 'HORARIOS' && datos.horas.length > 0 && (
        <ul className={estilos.horas} aria-label={`Horarios libres del ${datos.fecha}`}>
          {datos.horas.map((hora) => (
            <li key={hora.inicio}>
              <EnlaceDeHora hora={hora} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function Asistente() {
  const { usuario } = useSesion();
  const barberia = usuario?.barberia;
  const idCampo = useId();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [errorDeCampo, setErrorDeCampo] = useState<string | null>(null);

  const pregunta = useMutation({
    mutationFn: ({ mensaje, contexto }: { mensaje: string; contexto: Intervencion[] }) =>
      apiAsistente.preguntar(mensaje, contexto),
    onSuccess: (respuesta) =>
      setTurnos((previos) => [...previos, { de: 'ASISTENTE', texto: respuesta.texto, respuesta }]),
  });

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    const mensaje = texto.trim();
    if (mensaje === '') {
      setErrorDeCampo('Escribe tu pregunta.');
      return;
    }
    setErrorDeCampo(null);
    const contexto = turnos.slice(-MAXIMO_INTERVENCIONES).map(({ de, texto: t }) => ({ de, texto: t }));
    setTurnos((previos) => [...previos, { de: 'USUARIO', texto: mensaje }]);
    setTexto('');
    pregunta.mutate({ mensaje, contexto });
  };

  const aviso = pregunta.isError ? avisoDe(pregunta.error) : null;

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo />
        <Link to="/mis-citas" className={clasesBoton({ variante: 'fantasma', tamano: 'sm' })}>
          Mis citas
        </Link>
      </header>
      <div className={estilos.titulo}>
        <p className="antetitulo">{barberia?.nombre}</p>
        <h1>Asistente</h1>
        <p className={panel.aviso}>
          Pregúntame por los servicios, los barberos o los horarios libres de tu barbería. No reservo ni
          cambio citas: te llevo a Reservar con todo elegido.
        </p>
      </div>

      <section
        role="log"
        aria-live="polite"
        aria-label="Conversación"
        aria-busy={pregunta.isPending}
        className={estilos.conversacion}
      >
        {turnos.length === 0 && (
          <p className={estilos.vacio}>Todavía no hay preguntas. Escribe la tuya abajo.</p>
        )}
        {turnos.map((turno, i) => (
          <div key={i} className={turno.de === 'USUARIO' ? estilos.usuario : estilos.asistente}>
            <span className="sr-only">{turno.de === 'USUARIO' ? 'Tú:' : 'Asistente:'}</span>
            {turno.respuesta ? <Respuesta respuesta={turno.respuesta} /> : <p>{turno.texto}</p>}
          </div>
        ))}
        {pregunta.isPending && <p className={estilos.vacio}>Buscando la respuesta…</p>}
      </section>

      {aviso && (
        <div className={estilos.aviso}>
          <Alerta>
            {aviso.mensaje}
            {aviso.reinicio && ` Podrás volver a preguntar desde el ${aviso.reinicio}.`}
          </Alerta>
          {aviso.reservar && barberia && (
            <Link
              to={`/b/${barberia.slug}`}
              className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}
            >
              Ir a reservar
            </Link>
          )}
        </div>
      )}

      <form className={estilos.formulario} onSubmit={enviar} noValidate>
        <div className="campo">
          <label htmlFor={idCampo} className="campo__etiqueta">
            Tu pregunta
          </label>
          <textarea
            id={idCampo}
            className="entrada"
            rows={3}
            maxLength={MAXIMO_CARACTERES}
            value={texto}
            onChange={(evento) => setTexto(evento.target.value)}
            aria-invalid={errorDeCampo ? true : undefined}
            aria-describedby={`${idCampo}-contador${errorDeCampo ? ` ${idCampo}-error` : ''}`}
            placeholder="Por ejemplo: ¿hay horario mañana para un corte?"
          />
          <p id={`${idCampo}-contador`} className="campo__ayuda">
            {texto.length}/{MAXIMO_CARACTERES}
          </p>
          {errorDeCampo && (
            <p id={`${idCampo}-error`} className="mensaje-error" role="alert">
              {errorDeCampo}
            </p>
          )}
        </div>
        <div className={panel.acciones}>
          <Boton type="submit" disabled={pregunta.isPending}>
            Preguntar
          </Boton>
        </div>
      </form>
    </main>
  );
}
