import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useId, useState } from 'react';
import { ApiError } from '../../api/client';
import {
  apiSolicitudes,
  clavesSolicitudes,
  fechaLarga,
  type Solicitud,
  TEXTO_ESTADO,
  TEXTO_TIPO,
  type TipoSolicitud,
} from '../../api/solicitudes-datos';
import { CargandoLista } from '../../pages/panel/Cargando';
import { mensajeDeError } from '../../pages/panel/datos-barberia';
import { Icono } from '../Icono';
import { Alerta, Boton, EstadoVacio, EtiquetaEstado, type TonoEtiqueta } from '../ui';
import estilos from './DatosPersonales.module.css';

// T015 de 007 · "Mis datos" (US1; FR-001, FR-002, FR-006): el cliente o el barbero registra una solicitud de acceso,
// rectificación o eliminación sobre sus propios datos en la barbería de su sesión y ve las suyas, con el estado, el
// plazo y la respuesta. La atiende a mano el propietario; el sistema no exporta ni borra nada solo.

const OPCIONES: { tipo: TipoSolicitud; ayuda: string }[] = [
  { tipo: 'ACCESO', ayuda: 'Saber qué datos tuyos tiene la barbería.' },
  { tipo: 'RECTIFICACION', ayuda: 'Corregir un dato que está mal.' },
  { tipo: 'ELIMINACION', ayuda: 'Que se borren tus datos, salvo lo que se deba conservar por ley.' },
];

const NOMBRE_CORTO: Record<TipoSolicitud, string> = {
  ACCESO: 'acceso',
  RECTIFICACION: 'rectificación',
  ELIMINACION: 'eliminación',
};

export const TONO_ESTADO: Record<Solicitud['estado'], TonoEtiqueta> = {
  RECIBIDA: 'neutro',
  EN_ATENCION: 'acento',
  ATENDIDA: 'exito',
  RECHAZADA: 'error',
};

const LARGO_DETALLE = 500;
const ERROR_DETALLE = 'Escribe qué dato quieres corregir y cómo.';

type Mensaje = { tono: 'error' | 'exito'; texto: string } | null;

export function MisSolicitudes() {
  const consultas = useQueryClient();
  const idDetalle = useId();
  const mias = useQuery({ queryKey: clavesSolicitudes.mias, queryFn: () => apiSolicitudes.mias() });
  const [tipo, setTipo] = useState<TipoSolicitud | null>(null);
  const [detalle, setDetalle] = useState('');
  const [errorDetalle, setErrorDetalle] = useState<string | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [destacada, setDestacada] = useState<string | null>(null);

  const registrar = useMutation({
    mutationFn: apiSolicitudes.registrar,
    onSuccess: (nueva) => {
      setTipo(null);
      setDetalle('');
      setDestacada(null);
      setMensaje({
        tono: 'exito',
        texto: `Registramos tu solicitud. La barbería te responderá a más tardar el ${fechaLarga(nueva.venceEl)}.`,
      });
      void consultas.invalidateQueries({ queryKey: clavesSolicitudes.mias });
    },
    onError: (error, enviada) => {
      if (error instanceof ApiError && error.codigo === 'SOLICITUD_ABIERTA') {
        const id = error.detalles[0]?.solicitudId;
        setDestacada(typeof id === 'string' ? id : null);
        setMensaje({
          tono: 'error',
          texto: `Ya tienes una solicitud de ${NOMBRE_CORTO[enviada.tipo]} abierta. Puedes ver su estado en tu lista.`,
        });
        void consultas.invalidateQueries({ queryKey: clavesSolicitudes.mias });
        return;
      }
      if (error instanceof ApiError && error.detalles[0]?.campo === 'detalle') {
        setErrorDetalle(error.message);
        setMensaje(null);
        return;
      }
      setMensaje({ tono: 'error', texto: mensajeDeError(error) });
    },
  });

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    setMensaje(null);
    if (!tipo) {
      setMensaje({ tono: 'error', texto: 'Elige qué quieres pedir.' });
      return;
    }
    const texto = detalle.trim();
    if (tipo === 'RECTIFICACION' && texto.length === 0) {
      setErrorDetalle(ERROR_DETALLE);
      return;
    }
    setErrorDetalle(null);
    registrar.mutate(texto ? { tipo, detalle: texto } : { tipo });
  };

  const rectificacion = tipo === 'RECTIFICACION';

  return (
    <div className={estilos.seccion}>
      <section aria-labelledby={`${idDetalle}-nueva`} className={estilos.seccion}>
        <h2 id={`${idDetalle}-nueva`}>Nueva solicitud</h2>
        <form className={estilos.formulario} onSubmit={enviar} noValidate>
          <fieldset className={estilos.grupo}>
            <legend>¿Qué quieres pedir sobre tus datos personales?</legend>
            <div className={estilos.opciones}>
              {OPCIONES.map((opcion) => (
                <label key={opcion.tipo} className={`casilla ${estilos.opcion}`}>
                  <input
                    type="radio"
                    name="tipo-solicitud"
                    value={opcion.tipo}
                    checked={tipo === opcion.tipo}
                    onChange={() => {
                      setTipo(opcion.tipo);
                      setErrorDetalle(null);
                      setMensaje(null);
                    }}
                  />
                  <span className={estilos.textoOpcion}>
                    {TEXTO_TIPO[opcion.tipo]}
                    <span className={estilos.ayudaOpcion}>{opcion.ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="campo">
            <label htmlFor={idDetalle} className="campo__etiqueta">
              {rectificacion ? 'Qué dato quieres corregir y cómo' : 'Detalle (opcional)'}
            </label>
            <textarea
              id={idDetalle}
              className="entrada"
              rows={3}
              maxLength={LARGO_DETALLE}
              value={detalle}
              onChange={(evento) => {
                setDetalle(evento.target.value);
                setErrorDetalle(null);
              }}
              aria-invalid={errorDetalle ? true : undefined}
              aria-describedby={errorDetalle ? `${idDetalle}-error` : `${idDetalle}-ayuda`}
            />
            <p id={`${idDetalle}-ayuda`} className="campo__ayuda">
              Hasta {LARGO_DETALLE} caracteres. No escribas contraseñas ni datos de otras personas.
            </p>
            {errorDetalle && (
              <p id={`${idDetalle}-error`} className="mensaje-error">
                <Icono nombre="alerta" tamano={16} />
                {errorDetalle}
              </p>
            )}
          </div>

          {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

          <div className={estilos.acciones}>
            <Boton type="submit" cargando={registrar.isPending}>
              Enviar solicitud
            </Boton>
          </div>
        </form>
      </section>

      <section aria-labelledby={`${idDetalle}-lista`} className={estilos.seccion}>
        <h2 id={`${idDetalle}-lista`}>Mis solicitudes</h2>
        {mias.isPending ? (
          <CargandoLista texto="Cargando tus solicitudes…" filas={2} />
        ) : mias.isError ? (
          <Alerta>No se pudieron cargar tus solicitudes. {mensajeDeError(mias.error)}</Alerta>
        ) : mias.data.length === 0 ? (
          <EstadoVacio
            icono="escudo"
            titulo="Aún no tienes solicitudes"
            descripcion="Cuando registres una, verás aquí su estado, el plazo y la respuesta de la barbería."
          />
        ) : (
          <ul className={estilos.lista} aria-label="Mis solicitudes">
            {mias.data.map((s) => (
              <li
                key={s.id}
                className={`${estilos.solicitud} ${s.id === destacada ? estilos.destacada : ''}`}
              >
                <div className={estilos.cabecera}>
                  <span className={estilos.nombre}>{TEXTO_TIPO[s.tipo]}</span>
                  <EtiquetaEstado tono={TONO_ESTADO[s.estado]}>{TEXTO_ESTADO[s.estado]}</EtiquetaEstado>
                </div>
                {s.id === destacada && <p className={estilos.dato}>Esta es la que ya tienes abierta.</p>}
                <p className={estilos.dato}>
                  Plazo de respuesta: {fechaLarga(s.venceEl)}
                  {s.vencida ? ' (vencido)' : ''}
                </p>
                {s.detalle && <p className={estilos.texto}>Tu pedido: {s.detalle}</p>}
                {s.respuesta && <p className={estilos.texto}>Respuesta: {s.respuesta}</p>}
                {s.motivo && <p className={estilos.texto}>Motivo del rechazo: {s.motivo}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
