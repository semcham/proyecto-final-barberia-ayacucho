import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../api/client';
import { useSesion } from '../auth/SesionProvider';
import { Alerta, Boton, Campo, CampoContrasena } from '../components/ui';
import { Icono } from '../components/Icono';
import { MarcoAcceso } from '../components/MarcoAcceso';
import estilos from './Acceso.module.css';

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
  const estadoNavegacion = useLocation().state as { desde?: string; mensaje?: string } | null;
  const desde = estadoNavegacion?.desde ?? '/app';
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
    <MarcoAcceso
      antetitulo="Qué bueno verte"
      titular="Tu barbería, lista para la jornada"
      descripcion="Ingresa con tu correo y tu contraseña para ver tu barbería y a tu equipo."
      puntos={[
        {
          icono: 'celular',
          titulo: 'Desde cualquier celular',
          texto: 'Tu sesión funciona en el navegador, sin instalar nada.',
        },
        {
          icono: 'escudo',
          titulo: 'Acceso protegido',
          texto: 'Cada persona entra con su propia cuenta y su rol.',
        },
      ]}
      pie={
        <p>
          ¿Aún no registras tu barbería? <Link to="/registro">Empieza gratis</Link>
        </p>
      }
    >
      <div className={estilos.encabezado}>
        <h1>Ingresa a tu barbería</h1>
        <p className={estilos.lema}>Usa el correo con el que te registraste.</p>
      </div>
      {estadoNavegacion?.mensaje && (
        <p role="status" className={estilos.aviso}>
          <Icono nombre="check" tamano={18} />
          <span>{estadoNavegacion.mensaje}</span>
        </p>
      )}
      <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate>
        <Campo
          id="correo"
          etiqueta="Correo"
          icono="correo"
          type="email"
          inputMode="email"
          autoComplete="username"
          placeholder="tucorreo@ejemplo.com"
          registro={register('correo')}
          error={errors.correo?.message}
        />

        <CampoContrasena
          id="contrasena"
          etiqueta="Contraseña"
          autoComplete="current-password"
          registro={register('contrasena')}
          error={errors.contrasena?.message}
        />

        {error && <Alerta>{error}</Alerta>}

        <Boton type="submit" bloque cargando={isSubmitting} textoCargando="Ingresando…">
          Ingresar
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
