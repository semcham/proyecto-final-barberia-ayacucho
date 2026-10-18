import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { type DatosUnion, useSesion } from '../../auth/SesionProvider';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import { Alerta } from '../../components/ui/Alerta';
import { Boton } from '../../components/ui/Boton';
import { Campo, CampoContrasena } from '../../components/ui/Campo';
import estilos from '../Acceso.module.css';
import { FormularioUnion, mensajeDeError } from './Union';

const esquema = z.object({
  correo: z.string().trim().min(1, 'Ingresa tu correo.').max(254),
  contrasena: z.string().min(1, 'Ingresa tu contraseña.').max(128),
});

type Formulario = z.infer<typeof esquema>;

/**
 * Ingreso del cliente desde el enlace de la barbería (ADR-020): la sesión queda en esta barbería. Si la
 * cuenta aún no es cliente de ella, pide el consentimiento y el teléfono para unirse, sin otra cuenta.
 */
export default function IngresarBarberia() {
  const { slug = '' } = useParams();
  const desde = (useLocation().state as { desde?: string } | null)?.desde ?? `/b/${slug}`;
  const navegar = useNavigate();
  const { estado, usuario, iniciarSesion } = useSesion();
  const [error, setError] = useState<string | null>(null);
  // Credenciales ya verificadas por el servidor que esperan la aceptación para unirse.
  const [union, setUnion] = useState<{ datos: Formulario; mensaje: string } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });

  // Un cliente con sesión sigue a donde iba; si es de otra barbería, la pantalla de destino la cambia.
  if (estado === 'autenticado' && usuario?.rol === 'CLIENTE' && !union) {
    return <Navigate to={desde} replace />;
  }

  const enviar = async (datos: Formulario) => {
    setError(null);
    try {
      await iniciarSesion(datos.correo, datos.contrasena, { barberia: slug });
      navegar(desde, { replace: true });
    } catch (causa) {
      if (causa instanceof ApiError && causa.codigo === 'UNIRSE_REQUIERE_CONSENTIMIENTO') {
        setUnion({ datos, mensaje: causa.message });
      } else {
        setError(mensajeDeError(causa));
      }
    }
  };

  const unirse = async (datosUnion: DatosUnion) => {
    if (!union) return;
    await iniciarSesion(union.datos.correo, union.datos.contrasena, { barberia: slug, union: datosUnion });
    navegar(desde, { replace: true });
  };

  return (
    <MarcoAcceso
      antetitulo="Reserva en línea"
      titular="Qué bueno verte de nuevo"
      descripcion="Ingresa con tu cuenta para reservar en esta barbería."
      pie={
        <p>
          ¿Aún no tienes cuenta?{' '}
          <Link to={`/b/${slug}/registro`} state={{ desde }}>
            Créala aquí
          </Link>
        </p>
      }
    >
      <div className={estilos.encabezado}>
        <h1>{union ? 'Únete a esta barbería' : 'Ingresa para reservar'}</h1>
        <p className={estilos.lema}>
          {union ? 'Usarás la misma cuenta que ya tienes.' : 'Usa el correo con el que creaste tu cuenta.'}
        </p>
      </div>

      {union ? (
        <FormularioUnion mensaje={union.mensaje} alUnirse={unirse} />
      ) : (
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
            placeholder="Tu contraseña"
            registro={register('contrasena')}
            error={errors.contrasena?.message}
          />
          {error && <Alerta>{error}</Alerta>}
          <Boton type="submit" bloque cargando={isSubmitting} textoCargando="Ingresando…">
            Ingresar
          </Boton>
        </form>
      )}
    </MarcoAcceso>
  );
}
