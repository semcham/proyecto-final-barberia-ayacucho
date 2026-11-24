import { useMutation } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  apiAsistente,
  type Intervencion,
  MAXIMO_CARACTERES,
  MAXIMO_INTERVENCIONES,
  type RespuestaAsistente,
} from '../../api/asistente';
import { ApiError } from '../../api/client';
import { esCorreoNoVerificado } from '../../api/cuenta';
import { Alerta, Boton, clasesBoton } from '../ui';
import estilos from './Conversacion.module.css';

// 005 · La conversación con el asistente, compartida por el del cliente (/asistente, US1) y la pestaña "Preguntar" de
// los reportes del propietario (/app/reportes, US3). Las respuestas las compone el servidor con los datos de la
// barbería (las del propietario, con las mismas cifras de los reportes); aquí solo se muestran. La conversación vive
// solo en memoria y se envían como mucho las últimas 6 intervenciones (FR-012). Si se agota la cuota o el asistente no
// está disponible, se avisa y se ofrece la alternativa manual de quien la usa: Reservar o las tablas (FR-007, FR-008).

interface Turno {
  de: Intervencion['de'];
  texto: string;
  respuesta?: RespuestaAsistente;
}

type Hora = NonNullable<
  Extract<NonNullable<RespuestaAsistente['datos']>, { tipo: 'HORARIOS' }>['horas']
>[number];

/** La alternativa manual que ofrece la interfaz cuando el asistente no puede responder. */
export interface AlternativaDelAsistente {
  /** La que indica el servidor en el 503 (detalles[0].alternativa.tipo). */
  tipo: 'RESERVAR' | 'REPORTES';
  /** El enlace o el botón que lleva a ella. */
  contenido: ReactNode;
}

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
function avisoDe(
  error: unknown,
  alternativa: AlternativaDelAsistente['tipo'],
): { mensaje: string; reinicio?: string; conAlternativa: boolean } {
  if (!(error instanceof ApiError)) {
    return { mensaje: 'No pudimos conectar con el servidor. Intenta de nuevo.', conAlternativa: false };
  }
  const detalle = error.detalles[0] as { reiniciaEn?: unknown; alternativa?: { tipo?: unknown } } | undefined;
  if (error.codigo === 'CUOTA_ASISTENTE_AGOTADA') {
    const reinicio = typeof detalle?.reiniciaEn === 'string' ? momentoLocal(detalle.reiniciaEn) : undefined;
    return { mensaje: error.message, reinicio, conAlternativa: true };
  }
  if (error.codigo === 'ASISTENTE_NO_DISPONIBLE') {
    return { mensaje: error.message, conAlternativa: detalle?.alternativa?.tipo === alternativa };
  }
  return { mensaje: error.message, conAlternativa: false };
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

export function Conversacion({
  ejemplo,
  alternativa,
  alCorreoNoVerificado,
}: {
  /** El ejemplo del campo (placeholder). */
  ejemplo: string;
  alternativa: AlternativaDelAsistente;
  /** 010 (T063): el servidor respondió 403 CORREO_NO_VERIFICADO (el cliente verá el aviso de verificación). */
  alCorreoNoVerificado?: () => void;
}) {
  const idCampo = useId();
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [texto, setTexto] = useState('');
  const [errorDeCampo, setErrorDeCampo] = useState<string | null>(null);

  const pregunta = useMutation({
    mutationFn: ({ mensaje, contexto }: { mensaje: string; contexto: Intervencion[] }) =>
      apiAsistente.preguntar(mensaje, contexto),
    onSuccess: (respuesta) =>
      setTurnos((previos) => [...previos, { de: 'ASISTENTE', texto: respuesta.texto, respuesta }]),
    onError: (error) => {
      if (alCorreoNoVerificado && esCorreoNoVerificado(error)) alCorreoNoVerificado();
    },
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

  const aviso = pregunta.isError ? avisoDe(pregunta.error, alternativa.tipo) : null;

  return (
    <div className={estilos.contenedor}>
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
          {aviso.conAlternativa && alternativa.contenido}
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
            placeholder={ejemplo}
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
        <div className={estilos.acciones}>
          <Boton type="submit" disabled={pregunta.isPending}>
            Preguntar
          </Boton>
        </div>
      </form>
    </div>
  );
}
