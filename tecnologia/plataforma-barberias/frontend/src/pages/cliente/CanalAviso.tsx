import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { llamarApi } from '../../api/client';
import type { components } from '../../api/schema-004';
import { useSesion } from '../../auth/SesionProvider';
import { Logo } from '../../components/Logo';
import { Alerta, Boton, clasesBoton, ModalConfirmacion } from '../../components/ui';
import { Cargando } from '../panel/Cargando';
import { mensajeDeError } from '../panel/datos-barberia';
import estilosCitas from './MisCitas.module.css';
import estilos from './CanalAviso.module.css';

type PreferenciaAviso = components['schemas']['PreferenciaAviso'];
type CambioCanal = components['schemas']['CambiarPreferenciaAvisoRequest'];
type Canal = PreferenciaAviso['canal'];

const CLAVE = ['canal-de-aviso'] as const;
const RUTA = '/clientes/yo/aviso';
// Mismo formato que valida el backend (dígitos y espacios, con + opcional).
const NUMERO_VALIDO = /^\+?[0-9 ]{6,20}$/;

type Mensaje = { tono: 'error' | 'exito'; texto: string } | null;

/**
 * Cómo recibo mis avisos (004, RF33; FR-016 a FR-018; research R15). El cliente elige correo o WhatsApp en la
 * barbería de su sesión. WhatsApp propone su teléfono, muestra el texto del consentimiento con su versión y exige
 * marcar la casilla; cambiar el número exige aceptar de nuevo. El consentimiento se puede retirar.
 */
export default function CanalAviso() {
  const { usuario, cerrarSesion } = useSesion();
  const preferencia = useQuery({
    queryKey: CLAVE,
    queryFn: () => llamarApi<PreferenciaAviso>(RUTA),
  });

  return (
    <main className={estilosCitas.pagina}>
      <header className={estilosCitas.cabecera}>
        <Logo />
        <Boton
          type="button"
          variante="fantasma"
          tamano="sm"
          icono="salir"
          onClick={() => void cerrarSesion()}
        >
          Salir
        </Boton>
      </header>
      {preferencia.isPending ? (
        <Cargando texto="Cargando tu canal de aviso…" />
      ) : (
        <>
          {/* El título aparece con el contenido: al anunciarse, la pantalla ya se puede usar. */}
          <div className={estilosCitas.titulo}>
            <p className="antetitulo">{usuario?.barberia?.nombre}</p>
            <h1>Cómo recibo mis avisos</h1>
            <p>Confirmaciones, cambios y recordatorios de tus citas en esta barbería.</p>
          </div>
          <div>
            <Link to="/mis-citas" className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
              Volver a mis citas
            </Link>
          </div>
        </>
      )}

      <section aria-label="Canal de aviso">
        {preferencia.isPending ? null : preferencia.isError ? (
          <div className={estilos.formulario}>
            <Alerta>No se pudo cargar tu canal de aviso. {mensajeDeError(preferencia.error)}</Alerta>
            <div className={estilos.acciones}>
              <Boton
                type="button"
                variante="secundario"
                cargando={preferencia.isFetching}
                onClick={() => void preferencia.refetch()}
              >
                Intentar de nuevo
              </Boton>
            </div>
          </div>
        ) : (
          <FormularioCanal preferencia={preferencia.data} />
        )}
      </section>
    </main>
  );
}

function FormularioCanal({ preferencia }: { preferencia: PreferenciaAviso }) {
  const consultas = useQueryClient();
  const [canal, setCanal] = useState<Canal>(preferencia.canal);
  const [numero, setNumero] = useState(preferencia.numeroWhatsapp ?? preferencia.numeroPropuesto);
  const [acepta, setAcepta] = useState(false);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [retirando, setRetirando] = useState(false);

  const numeroLimpio = numero.trim();
  // Ya aceptó este mismo número con el texto vigente: no hace falta volver a marcar la casilla.
  const yaAceptado = preferencia.consentimientoVigente && numeroLimpio === (preferencia.numeroWhatsapp ?? '');
  const textoConNumero = preferencia.textoConsentimiento.texto.replaceAll(
    '{número}',
    numeroLimpio || 'tu número',
  );

  const guardar = useMutation({
    mutationFn: (cuerpo: CambioCanal) => llamarApi<PreferenciaAviso>(RUTA, { metodo: 'PUT', cuerpo }),
    onSuccess: (nueva) => {
      consultas.setQueryData(CLAVE, nueva);
      setAcepta(false);
      setMensaje({
        tono: 'exito',
        texto:
          nueva.canal === 'WHATSAPP'
            ? `Listo. Tus avisos llegarán por WhatsApp al ${nueva.numeroWhatsapp ?? numeroLimpio}.`
            : 'Listo. Tus avisos llegarán por correo.',
      });
    },
    onError: (error) => setMensaje({ tono: 'error', texto: mensajeDeError(error) }),
  });

  const retirar = useMutation({
    mutationFn: () => llamarApi<void>(`${RUTA}/consentimiento-whatsapp`, { metodo: 'DELETE' }),
    onSuccess: () => {
      consultas.setQueryData<PreferenciaAviso>(CLAVE, {
        ...preferencia,
        canal: 'CORREO',
        consentimientoVigente: false,
        aceptadoEn: null,
      });
      setRetirando(false);
      setCanal('CORREO');
      setAcepta(false);
      setMensaje({ tono: 'exito', texto: 'Retiraste tu consentimiento. Tus avisos llegarán por correo.' });
    },
    onError: (error) => {
      setRetirando(false);
      setMensaje({ tono: 'error', texto: mensajeDeError(error) });
    },
  });

  const enviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (canal === 'CORREO') {
      guardar.mutate({ canal: 'CORREO' });
      return;
    }
    if (!NUMERO_VALIDO.test(numeroLimpio)) {
      setMensaje({ tono: 'error', texto: 'Escribe un número de WhatsApp válido: solo dígitos, de 6 a 20.' });
      return;
    }
    if (!yaAceptado && !acepta) {
      setMensaje({
        tono: 'error',
        texto: 'Para recibir tus avisos por WhatsApp, marca la casilla de aceptación.',
      });
      return;
    }
    guardar.mutate(
      yaAceptado
        ? { canal: 'WHATSAPP', numeroWhatsapp: numeroLimpio }
        : {
            canal: 'WHATSAPP',
            numeroWhatsapp: numeroLimpio,
            aceptaWhatsapp: true,
            versionTexto: preferencia.textoConsentimiento.version,
          },
    );
  };

  const cambiarCanal = (nuevo: Canal) => {
    setCanal(nuevo);
    setMensaje(null);
  };

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate>
      <fieldset className={estilos.grupo}>
        <legend>¿Por dónde quieres recibir tus avisos?</legend>
        <div className={estilos.opciones}>
          <label className={`casilla ${estilos.opcion}`}>
            <input
              type="radio"
              name="canal"
              value="CORREO"
              checked={canal === 'CORREO'}
              onChange={() => cambiarCanal('CORREO')}
            />
            <span className={estilos.textoOpcion}>
              Correo
              <span className={estilos.detalle}>Al correo de tu cuenta.</span>
            </span>
          </label>
          <label className={`casilla ${estilos.opcion}`}>
            <input
              type="radio"
              name="canal"
              value="WHATSAPP"
              checked={canal === 'WHATSAPP'}
              onChange={() => cambiarCanal('WHATSAPP')}
            />
            <span className={estilos.textoOpcion}>
              WhatsApp
              <span className={estilos.detalle}>Solo si lo aceptas expresamente.</span>
            </span>
          </label>
        </div>
      </fieldset>

      {canal === 'WHATSAPP' && (
        <>
          <div className="campo">
            <label htmlFor="numero-whatsapp" className="campo__etiqueta">
              Número de WhatsApp
            </label>
            <div className="campo__control">
              <input
                id="numero-whatsapp"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                className="entrada"
                value={numero}
                aria-describedby="numero-whatsapp-ayuda"
                onChange={(evento) => {
                  setNumero(evento.target.value);
                  setAcepta(false);
                  setMensaje(null);
                }}
              />
            </div>
            <p id="numero-whatsapp-ayuda" className="campo__ayuda">
              Te proponemos tu teléfono de contacto; cambiar este número no cambia tu teléfono.
            </p>
          </div>

          <fieldset className={estilos.consentimiento}>
            <legend>Consentimiento para avisos por WhatsApp</legend>
            <p className={estilos.texto}>{textoConNumero}</p>
            <p className={estilos.version}>Versión {preferencia.textoConsentimiento.version}</p>
            {yaAceptado ? (
              <p className={estilos.version}>
                {preferencia.aceptadoEn
                  ? `Aceptaste este texto el ${new Date(preferencia.aceptadoEn).toLocaleDateString('es-PE', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}.`
                  : 'Ya aceptaste este texto para este número.'}
              </p>
            ) : (
              <label className="casilla">
                <input
                  type="checkbox"
                  checked={acepta}
                  onChange={(evento) => {
                    setAcepta(evento.target.checked);
                    setMensaje(null);
                  }}
                />
                <span>Acepto recibir mis avisos por WhatsApp</span>
              </label>
            )}
          </fieldset>
        </>
      )}

      {mensaje && <Alerta tono={mensaje.tono}>{mensaje.texto}</Alerta>}

      <div className={estilos.acciones}>
        <Boton type="submit" cargando={guardar.isPending}>
          Guardar
        </Boton>
        {preferencia.consentimientoVigente && (
          <Boton type="button" variante="peligro" onClick={() => setRetirando(true)}>
            Retirar mi consentimiento
          </Boton>
        )}
      </div>

      <ModalConfirmacion
        abierto={retirando}
        onAbiertoCambia={setRetirando}
        titulo="¿Retirar tu consentimiento de WhatsApp?"
        descripcion="Dejaremos de enviarte avisos por WhatsApp en esta barbería y te llegarán por correo. Puedes volver a aceptarlo cuando quieras."
        textoConfirmar="Sí, retirar"
        textoCancelar="Volver"
        variante="peligro"
        cargando={retirar.isPending}
        onConfirmar={() => retirar.mutate()}
      />
    </form>
  );
}
