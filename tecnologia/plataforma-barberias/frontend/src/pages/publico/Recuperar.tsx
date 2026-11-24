import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { mensajeDeErrorDeCuenta, pedirRecuperacion } from '../../api/cuenta';
import { Icono } from '../../components/Icono';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import { Campo } from '../../components/ui/Campo';
import estilos from '../Acceso.module.css';

// Solo se pide que no esté vacío: el formato no se valida aquí, para que nada dependa de si la cuenta existe.
const esquema = z.object({
  correo: z.string().trim().min(1, 'Escribe tu correo.').max(254, 'El correo es demasiado largo.'),
});
type Formulario = z.infer<typeof esquema>;

/** Mismo formato que el enlace de la barbería; otro valor que llegue en el estado de la navegación se ignora. */
const FORMATO_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * T079 de 010 · Pedir la recuperación de la contraseña (US2; FR-018 a FR-020; contracts/pantallas.md). Pública. Si se
 * llega desde el ingreso de una barbería (`state.barberia`), se envía su enlace para que el aviso salga de ella. Tras
 * enviar, siempre el mismo mensaje, exista o no la cuenta; un 429 muestra el tiempo de espera.
 */
export default function Recuperar() {
  const estado = useLocation().state as { barberia?: unknown } | null;
  const barberia =
    typeof estado?.barberia === 'string' && FORMATO_SLUG.test(estado.barberia) ? estado.barberia : undefined;
  const volver = barberia ? `/b/${barberia}/ingresar` : '/ingresar';
  const pedir = useMutation({ mutationFn: (correo: string) => pedirRecuperacion(correo, barberia) });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });

  return (
    <MarcoAcceso
      antetitulo="Recupera tu acceso"
      titular="Vuelve a entrar en minutos"
      descripcion="Te enviamos un enlace a tu correo para que elijas una contraseña nueva."
      pie={
        <p>
          ¿La recordaste? <Link to={volver}>Vuelve a ingresar</Link>
        </p>
      }
    >
      <div className={estilos.encabezado}>
        <h1>¿Olvidaste tu contraseña?</h1>
        <p className={estilos.lema}>
          <Icono nombre="candado" tamano={18} />
          Escribe el correo de tu cuenta.
        </p>
      </div>
      {pedir.isSuccess ? (
        <>
          <p role="status" className={estilos.aviso}>
            <Icono nombre="check" tamano={18} />
            <span>
              Si hay una cuenta con ese correo, te enviamos un enlace. Revisa tu bandeja (y la carpeta de
              spam): el enlace vale 1 hora.
            </span>
          </p>
          <Link
            to={volver}
            className={clasesBoton({ variante: 'secundario', bloque: true, className: estilos.enlaceAccion })}
          >
            Volver a ingresar
          </Link>
        </>
      ) : (
        <form
          className={estilos.formulario}
          aria-label="Recuperar la contraseña"
          onSubmit={handleSubmit((datos) => pedir.mutate(datos.correo))}
          noValidate
        >
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
          {pedir.isError && <Alerta>{mensajeDeErrorDeCuenta(pedir.error)}</Alerta>}
          <Boton type="submit" bloque icono="correo" cargando={pedir.isPending} textoCargando="Enviando…">
            Enviarme el enlace
          </Boton>
        </form>
      )}
    </MarcoAcceso>
  );
}
