import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { mensajeDeErrorDeCuenta, restablecerContrasena } from '../../api/cuenta';
import { Icono } from '../../components/Icono';
import { IndicadorFortaleza } from '../../components/IndicadorFortaleza';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { CampoContrasena } from '../../components/ui/Campo';
import { ultimaBarberia } from '../../ultima-barberia';
import estilos from '../Acceso.module.css';

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
  antetitulo: 'Recupera tu acceso',
  titular: 'Una contraseña nueva, y listo',
  descripcion: 'Al cambiarla se cierran tus sesiones abiertas en todos tus dispositivos.',
} as const;

const AVISO_CAMBIO = 'Tu contraseña cambió; ingresa con la nueva.';

const esNoValido = (error: unknown) =>
  error instanceof ApiError && (error.codigo === 'ENLACE_NO_VALIDO' || error.estado === 400);

function mensajeDeError(error: unknown): string {
  if (error instanceof ApiError && error.codigo === 'VALIDACION' && error.estado === 422) {
    return 'Elige una contraseña más segura: más larga, que no sea común ni contenga tu correo.';
  }
  return mensajeDeErrorDeCuenta(error);
}

/**
 * T079 de 010 · Elegir la contraseña nueva con el enlace del correo: `/restablecer#<token>` (US2; FR-021 a FR-023;
 * research R09). El token llega en el FRAGMENTO: se lee una vez, se quita de la dirección y vive solo en memoria. Con
 * éxito, lleva al ingreso (el de la última barbería si se conoce) con el aviso del cambio; un enlace que no sirve
 * muestra un mensaje neutro y el camino para pedir otro.
 */
export default function Restablecer() {
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const [token] = useState(() => decodeURIComponent(ubicacion.hash.replace(/^#/, '')) || null);
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });
  const contrasena = useWatch({ control, name: 'contrasena' }) ?? '';

  useEffect(() => {
    // Quita el token de la dirección (y del historial: replace) apenas se lee.
    if (ubicacion.hash) navegar(ubicacion.pathname, { replace: true });
  }, [ubicacion.hash, ubicacion.pathname, navegar]);

  const cambiar = useMutation({
    mutationFn: (datos: Formulario) => restablecerContrasena(token as string, datos.contrasena),
    onSuccess: () => {
      const ultima = ultimaBarberia.leer();
      navegar(ultima ? `/b/${ultima.slug}/ingresar` : '/ingresar', {
        replace: true,
        state: { mensaje: AVISO_CAMBIO },
      });
    },
  });

  if (!token || esNoValido(cambiar.error)) {
    return (
      <MarcoAcceso {...MARCO}>
        <div className={estilos.encabezado}>
          <h1>Este enlace ya no es válido</h1>
          <p className={estilos.lema}>
            Puede que ya lo hayas usado, que haya pasado su hora o que hayas pedido otro más nuevo.
          </p>
        </div>
        <Link
          to="/recuperar"
          className={clasesBoton({ variante: 'primario', bloque: true, className: estilos.enlaceAccion })}
        >
          Pedir un enlace nuevo
        </Link>
      </MarcoAcceso>
    );
  }

  return (
    <MarcoAcceso {...MARCO}>
      <div className={estilos.encabezado}>
        <h1>Elige tu contraseña nueva</h1>
        <p className={estilos.lema}>
          <Icono nombre="candado" tamano={18} />
          Úsala para ingresar desde ahora.
        </p>
      </div>
      <form
        className={estilos.formulario}
        aria-label="Elegir la contraseña nueva"
        onSubmit={handleSubmit((datos) => cambiar.mutate(datos))}
        noValidate
      >
        <CampoContrasena
          id="contrasena"
          etiqueta="Contraseña nueva"
          autoComplete="new-password"
          placeholder="Crea una contraseña"
          registro={register('contrasena')}
          ayuda="Al menos 10 caracteres. Una frase fácil de recordar funciona bien."
          error={errors.contrasena?.message}
          extra={<IndicadorFortaleza valor={contrasena} />}
        />
        <CampoContrasena
          id="confirmacion"
          etiqueta="Repite la contraseña"
          autoComplete="new-password"
          placeholder="Escríbela otra vez"
          registro={register('confirmacion')}
          error={errors.confirmacion?.message}
        />
        {cambiar.isError && <Alerta>{mensajeDeError(cambiar.error)}</Alerta>}
        <Boton type="submit" bloque icono="candado" cargando={cambiar.isPending} textoCargando="Guardando…">
          Guardar mi contraseña nueva
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
