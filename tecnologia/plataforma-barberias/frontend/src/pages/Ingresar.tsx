import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { useSesion } from '../auth/SesionProvider';
import estilos from './Registro.module.css';

const esquema = z.object({
  correo: z.string().trim().min(1, 'Ingresa tu correo.').max(254),
  contrasena: z.string().min(1, 'Ingresa tu contraseña.').max(128),
});

type Formulario = z.infer<typeof esquema>;

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  }
  if (error.codigo === 'DEMASIADOS_INTENTOS') {
    const segundos = error.reintentarEnSegundos;
    return segundos
      ? `Demasiados intentos. Vuelve a intentar en ${segundos} segundos.`
      : 'Demasiados intentos. Espera un momento antes de volver a intentar.';
  }
  // 401 genérico ("correo o contraseña incorrectos") y 403 de acceso suspendido: se muestra el mensaje del servidor.
  return error.message;
}

/** Inicio de sesión (HU05, RF04). */
export default function Ingresar() {
  const { estado, iniciarSesion } = useSesion();
  const navegar = useNavigate();
  const desde = (useLocation().state as { desde?: string } | null)?.desde ?? '/app';
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });

  if (estado === 'autenticado') return <Navigate to={desde} replace />;

  const enviar = async (datos: Formulario) => {
    setError(null);
    try {
      await iniciarSesion(datos.correo, datos.contrasena);
      navegar(desde, { replace: true });
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  };

  return (
    <main className="contenedor">
      <h1>Ingresa a tu barbería</h1>
      <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate>
        <div className={estilos.campo}>
          <label htmlFor="correo">Correo</label>
          <input id="correo" type="email" inputMode="email" autoComplete="username" {...register('correo')} />
          {errors.correo && <p className="mensaje-error">{errors.correo.message}</p>}
        </div>

        <div className={estilos.campo}>
          <label htmlFor="contrasena">Contraseña</label>
          <input
            id="contrasena"
            type="password"
            autoComplete="current-password"
            {...register('contrasena')}
          />
          {errors.contrasena && <p className="mensaje-error">{errors.contrasena.message}</p>}
        </div>

        {error && (
          <p role="alert" className="mensaje-error">
            {error}
          </p>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>

      <p className={estilos.pie}>
        ¿Aún no registras tu barbería? <Link to="/registro">Empieza gratis</Link>
      </p>
    </main>
  );
}
