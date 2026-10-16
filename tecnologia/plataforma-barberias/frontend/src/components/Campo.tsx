import { type InputHTMLAttributes, type ReactNode, useState } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import { Icono, type NombreIcono } from './Icono';

type AtributosEntrada = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'autoComplete' | 'inputMode' | 'placeholder'
>;

interface PropiedadesCampo extends AtributosEntrada {
  id: string;
  etiqueta: string;
  registro: UseFormRegisterReturn;
  icono?: NombreIcono;
  ayuda?: ReactNode;
  error?: string;
  /** Contenido extra bajo la entrada (por ejemplo, el indicador de seguridad de la contraseña). */
  extra?: ReactNode;
}

/** Campo de formulario con etiqueta asociada, icono opcional, ayuda y error enlazados por aria-describedby. */
export function Campo({
  id,
  etiqueta,
  registro,
  icono,
  ayuda,
  error,
  extra,
  type = 'text',
  ...resto
}: PropiedadesCampo) {
  return (
    <ContenedorCampo id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} extra={extra}>
      {(descripcion) => (
        <div className="campo__control">
          {icono && (
            <span className="campo__icono">
              <Icono nombre={icono} />
            </span>
          )}
          <input
            id={id}
            type={type}
            className={`entrada${icono ? ' entrada--con-icono' : ''}`}
            aria-invalid={error ? true : undefined}
            aria-describedby={descripcion}
            {...resto}
            {...registro}
          />
        </div>
      )}
    </ContenedorCampo>
  );
}

/**
 * Campo de contraseña con botón para mostrarla u ocultarla. El nombre del botón va como texto oculto (no
 * como aria-label) y el botón queda fuera de la etiqueta, así la etiqueta solo nombra a la entrada.
 */
export function CampoContrasena({
  id,
  etiqueta,
  registro,
  ayuda,
  error,
  extra,
  autoComplete,
}: Omit<PropiedadesCampo, 'type' | 'icono' | 'inputMode' | 'placeholder'>) {
  const [visible, setVisible] = useState(false);
  return (
    <ContenedorCampo id={id} etiqueta={etiqueta} ayuda={ayuda} error={error} extra={extra}>
      {(descripcion) => (
        <div className="campo__control">
          <span className="campo__icono">
            <Icono nombre="candado" />
          </span>
          <input
            id={id}
            type={visible ? 'text' : 'password'}
            className="entrada entrada--con-icono entrada--con-accion"
            autoComplete={autoComplete}
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={descripcion}
            {...registro}
          />
          <button
            type="button"
            className="campo__accion"
            aria-controls={id}
            aria-pressed={visible}
            onClick={() => setVisible((v) => !v)}
          >
            <Icono nombre={visible ? 'ojoTachado' : 'ojo'} />
            <span className="sr-only">{visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}</span>
          </button>
        </div>
      )}
    </ContenedorCampo>
  );
}

function ContenedorCampo({
  id,
  etiqueta,
  ayuda,
  error,
  extra,
  children,
}: {
  id: string;
  etiqueta: string;
  ayuda?: ReactNode;
  error?: string;
  extra?: ReactNode;
  children: (descripcion: string | undefined) => ReactNode;
}) {
  const idAyuda = ayuda ? `${id}-ayuda` : undefined;
  const idError = error ? `${id}-error` : undefined;
  const descripcion = [idError, idAyuda].filter(Boolean).join(' ') || undefined;
  return (
    <div className="campo">
      <label htmlFor={id} className="campo__etiqueta">
        {etiqueta}
      </label>
      {children(descripcion)}
      {extra}
      {ayuda && (
        <p id={idAyuda} className="campo__ayuda">
          {ayuda}
        </p>
      )}
      {error && (
        <p id={idError} className="mensaje-error">
          <Icono nombre="alerta" tamano={16} />
          {error}
        </p>
      )}
    </div>
  );
}

/** Alerta de error de la pantalla (una sola por pantalla, con role="alert"). */
export function AlertaError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="alerta alerta--error">
      <Icono nombre="alerta" tamano={18} />
      <span>{children}</span>
    </p>
  );
}

/** Botón principal de envío con estado de carga visible. */
export function BotonEnviar({
  cargando,
  texto,
  textoCargando,
  icono,
}: {
  cargando: boolean;
  texto: string;
  textoCargando: string;
  icono?: NombreIcono;
}) {
  return (
    <button
      type="submit"
      className="boton boton--primario boton--bloque"
      disabled={cargando}
      aria-busy={cargando || undefined}
    >
      {cargando ? (
        <span className="girador" aria-hidden="true" />
      ) : (
        icono && <Icono nombre={icono} tamano={18} />
      )}
      {cargando ? textoCargando : texto}
    </button>
  );
}
