import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, llamarApi } from '../api/client';
import estilos from './Registro.module.css';

const esquema = z
  .object({
    contrasena: z
      .string()
      .min(10, 'La contraseña debe tener al menos 10 caracteres.')
      .max(128, 'La contraseña no puede pasar de 128 caracteres.'),
    confirmacion: z.string(),
  })
  .refine((datos) => datos.contrasena === datos.confirmacion, {
    message: 'Las contraseñas no coinciden.',
    path: ['confirmacion'],
  });

type Formulario = z.infer<typeof esquema>;

const ENLACE_INVALIDO = 'El enlace no es válido o ya venció. Pide uno nuevo al propietario.';

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  if (error.codigo === 'VALIDACION' && error.detalles.some((d) => d.campo === 'contrasena')) {
    return 'Elige una contraseña más segura: más larga, que no sea común ni contenga tu correo.';
  }
  if (error.codigo === 'VALIDACION' && error.detalles.some((d) => d.campo === 'token'))
    return ENLACE_INVALIDO;
  return error.message;
}

/** El barbero crea su contraseña con el enlace que le entregó el propietario (FR-022). Página pública. */
export default function Activar() {
  const token = useSearchParams()[0].get('token');
  const navegar = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });

  if (!token) {
    return (
      <main className="contenedor">
        <h1>Activa tu cuenta</h1>
        <p role="alert" className="mensaje-error">
          {ENLACE_INVALIDO}
        </p>
        <Link to="/ingresar">Ir a ingresar</Link>
      </main>
    );
  }

  const enviar = async (datos: Formulario) => {
    setError(null);
    try {
      await llamarApi('/auth/activar', {
        metodo: 'POST',
        cuerpo: { token, contrasena: datos.contrasena },
        sinRenovar: true,
      });
      navegar('/ingresar', {
        replace: true,
        state: { mensaje: 'Tu cuenta está activa. Ingresa con tu correo y tu nueva contraseña.' },
      });
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  };

  return (
    <main className="contenedor">
      <h1>Activa tu cuenta</h1>
      <p>Crea la contraseña con la que ingresarás a la barbería.</p>
      <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate>
        <div className={estilos.campo}>
          <label htmlFor="contrasena">Contraseña</label>
          <input id="contrasena" type="password" autoComplete="new-password" {...register('contrasena')} />
          <p className={estilos.ayuda}>Al menos 10 caracteres. Una frase fácil de recordar funciona bien.</p>
          {errors.contrasena && <p className="mensaje-error">{errors.contrasena.message}</p>}
        </div>
        <div className={estilos.campo}>
          <label htmlFor="confirmacion">Repite la contraseña</label>
          <input
            id="confirmacion"
            type="password"
            autoComplete="new-password"
            {...register('confirmacion')}
          />
          {errors.confirmacion && <p className="mensaje-error">{errors.confirmacion.message}</p>}
        </div>
        {error && (
          <p role="alert" className="mensaje-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Activando…' : 'Activar mi cuenta'}
        </button>
      </form>
    </main>
  );
}
