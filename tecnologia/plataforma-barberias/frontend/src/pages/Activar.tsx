import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, llamarApi } from '../api/client';
import { AlertaError, BotonEnviar, CampoContrasena } from '../components/Campo';
import { Icono } from '../components/Icono';
import { IndicadorFortaleza } from '../components/IndicadorFortaleza';
import { MarcoAcceso } from '../components/MarcoAcceso';
import estilos from './Acceso.module.css';

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

const MARCO = {
  antetitulo: 'Te sumaron al equipo',
  titular: 'Únete a tu barbería',
  descripcion: 'Crea tu contraseña y empieza a trabajar con tu equipo desde el celular.',
} as const;

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
    control,
    formState: { errors, isSubmitting },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });
  const contrasena = useWatch({ control, name: 'contrasena' }) ?? '';

  if (!token) {
    return (
      <MarcoAcceso {...MARCO}>
        <div className={estilos.encabezado}>
          <h1>Activa tu cuenta</h1>
        </div>
        <AlertaError>{ENLACE_INVALIDO}</AlertaError>
        <Link to="/ingresar" className={`boton boton--secundario boton--bloque ${estilos.enlaceAccion}`}>
          Ir a ingresar
        </Link>
      </MarcoAcceso>
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
    <MarcoAcceso {...MARCO}>
      <div className={estilos.encabezado}>
        <h1>Activa tu cuenta</h1>
        <p className={estilos.lema}>
          <Icono nombre="candado" tamano={18} />
          Crea la contraseña con la que ingresarás a la barbería.
        </p>
      </div>
      <form className={estilos.formulario} onSubmit={handleSubmit(enviar)} noValidate>
        <CampoContrasena
          id="contrasena"
          etiqueta="Contraseña"
          autoComplete="new-password"
          registro={register('contrasena')}
          ayuda="Al menos 10 caracteres. Una frase fácil de recordar funciona bien."
          error={errors.contrasena?.message}
          extra={<IndicadorFortaleza valor={contrasena} />}
        />
        <CampoContrasena
          id="confirmacion"
          etiqueta="Repite la contraseña"
          autoComplete="new-password"
          registro={register('confirmacion')}
          error={errors.confirmacion?.message}
        />
        {error && <AlertaError>{error}</AlertaError>}
        <BotonEnviar cargando={isSubmitting} texto="Activar mi cuenta" textoCargando="Activando…" />
      </form>
    </MarcoAcceso>
  );
}
