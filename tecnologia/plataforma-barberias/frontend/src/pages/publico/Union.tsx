import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { type FieldError, type UseFormRegisterReturn, useForm } from 'react-hook-form';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import type { DatosUnion } from '../../auth/SesionProvider';
import { Icono } from '../../components/Icono';
import { Alerta } from '../../components/ui/Alerta';
import { Boton } from '../../components/ui/Boton';
import { Campo } from '../../components/ui/Campo';
import { VERSION_POLITICA_DATOS } from '../../legal';
import estilos from '../Acceso.module.css';

// Piezas comunes de la cuenta de cliente (US3): reglas del contrato de 002 para el teléfono y la aceptación,
// la casilla de la política de datos y el paso de unión a una barbería nueva (ADR-020).

export const reglaTelefono = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ]{6,20}$/, 'Ingresa un teléfono válido (de 6 a 20 dígitos).');

export const reglaAceptaPolitica = z.literal(true, {
  errorMap: () => ({ message: 'Debes aceptar la política de tratamiento de datos.' }),
});

/** Mensaje para un error de la API; sin respuesta del servidor, el de conexión. */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  }
  if (error.codigo === 'DEMASIADOS_INTENTOS' && error.reintentarEnSegundos) {
    return `Demasiados intentos. Vuelve a intentar en ${error.reintentarEnSegundos} segundos.`;
  }
  return error.message;
}

/** Casilla de aceptación de la política de datos con su versión vigente (FR-023). Nunca viene marcada. */
export function CasillaPolitica({
  registro,
  error,
}: {
  registro: UseFormRegisterReturn;
  error?: FieldError;
}) {
  return (
    <fieldset className={estilos.aceptaciones}>
      <legend className="sr-only">Consentimiento</legend>
      <label className="casilla">
        <input
          id="aceptaPolitica"
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'aceptaPolitica-error' : undefined}
          {...registro}
        />
        <span>
          Acepto la política de tratamiento de datos (versión {VERSION_POLITICA_DATOS}) de esta barbería
        </span>
      </label>
      {error && (
        <p id="aceptaPolitica-error" className="mensaje-error">
          <Icono nombre="alerta" tamano={16} />
          {error.message}
        </p>
      )}
    </fieldset>
  );
}

const esquemaUnion = z.object({ telefono: reglaTelefono, aceptaPolitica: reglaAceptaPolitica });
type FormularioUnion = z.infer<typeof esquemaUnion>;

/**
 * Paso de unión: la cuenta existe, pero aún no es cliente de esta barbería (409
 * `UNIRSE_REQUIERE_CONSENTIMIENTO`). Pide el teléfono y la aceptación, y llama a `alUnirse`.
 */
export function FormularioUnion({
  mensaje,
  alUnirse,
}: {
  mensaje: string;
  alUnirse(datos: DatosUnion): Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormularioUnion>({ resolver: zodResolver(esquemaUnion) });

  const enviar = async (datos: FormularioUnion) => {
    setError(null);
    try {
      await alUnirse({
        aceptaPoliticaDatos: true,
        versionPoliticaDatos: VERSION_POLITICA_DATOS,
        telefono: datos.telefono,
      });
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  };

  return (
    <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate>
      <p role="status" className={estilos.aviso}>
        <Icono nombre="info" tamano={18} />
        <span>{mensaje}</span>
      </p>
      <Campo
        id="telefono"
        etiqueta="Teléfono"
        icono="celular"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        placeholder="Ej.: 966 123 456"
        ayuda="La barbería lo usa solo para avisarte sobre tus citas."
        registro={register('telefono')}
        error={errors.telefono?.message}
      />
      <CasillaPolitica registro={register('aceptaPolitica')} error={errors.aceptaPolitica} />
      {error && <Alerta>{error}</Alerta>}
      <Boton type="submit" bloque cargando={isSubmitting} textoCargando="Uniéndote…">
        Unirme y continuar
      </Boton>
    </form>
  );
}
