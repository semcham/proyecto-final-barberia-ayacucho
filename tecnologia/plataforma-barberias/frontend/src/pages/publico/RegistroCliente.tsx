import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';
import { useSesion } from '../../auth/SesionProvider';
import { IndicadorFortaleza } from '../../components/IndicadorFortaleza';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import { Alerta } from '../../components/ui/Alerta';
import { Boton } from '../../components/ui/Boton';
import { Campo, CampoContrasena } from '../../components/ui/Campo';
import { VERSION_POLITICA_DATOS } from '../../legal';
import estilos from '../Acceso.module.css';
import { CasillaPolitica, mensajeDeError, reglaAceptaPolitica, reglaTelefono } from './Union';

type SesionResponse = components['schemas']['SesionResponse'];
type SolicitudRegistro = components['schemas']['RegistroClienteRequest'];

// Solo los datos mínimos para reservar (minimización, FR-023). El servidor vuelve a validar todo.
const esquema = z.object({
  nombre: z
    .string()
    .trim()
    .min(2, 'Ingresa tu nombre (al menos 2 caracteres).')
    .max(120, 'El nombre no puede pasar de 120 caracteres.'),
  correo: z.string().trim().max(254).email('Ingresa un correo válido.'),
  telefono: reglaTelefono,
  contrasena: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres.')
    .max(128, 'La contraseña no puede pasar de 128 caracteres.'),
  aceptaPolitica: reglaAceptaPolitica,
});

type Formulario = z.infer<typeof esquema>;

/** Registro de cliente desde el enlace de la barbería (HU06, RF05): deja la sesión abierta en ella. */
export default function RegistroCliente() {
  const { slug = '' } = useParams();
  const desde = (useLocation().state as { desde?: string } | null)?.desde ?? `/b/${slug}`;
  const navegar = useNavigate();
  const { establecer } = useSesion();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema) });
  const contrasena = useWatch({ control, name: 'contrasena' }) ?? '';

  const registro = useMutation({
    mutationFn: (datos: Formulario) =>
      llamarApi<SesionResponse>('/clientes/registro', {
        metodo: 'POST',
        sinRenovar: true,
        cuerpo: {
          barberia: slug,
          nombre: datos.nombre,
          correo: datos.correo,
          telefono: datos.telefono,
          contrasena: datos.contrasena,
          aceptaPoliticaDatos: true,
          versionPoliticaDatos: VERSION_POLITICA_DATOS,
        } satisfies SolicitudRegistro,
      }),
    onSuccess: (sesion) => {
      establecer(sesion);
      navegar(desde, { replace: true });
    },
  });

  const correoConCuenta =
    registro.error instanceof ApiError && registro.error.codigo === 'CORREO_NO_DISPONIBLE';

  return (
    <MarcoAcceso
      antetitulo="Reserva en línea"
      titular="Tu próxima cita, a un toque"
      descripcion="Crea tu cuenta una sola vez y reserva en esta barbería cuando quieras."
      puntos={[
        { icono: 'calendario', titulo: 'Elige día y hora', texto: 'Ves solo los horarios libres de verdad.' },
        { icono: 'escudo', titulo: 'Tus datos, cuidados', texto: 'Pedimos solo lo necesario para tu cita.' },
      ]}
      pie={
        <p>
          ¿Ya tienes cuenta?{' '}
          <Link to={`/b/${slug}/ingresar`} state={{ desde }}>
            Inicia sesión
          </Link>
        </p>
      }
    >
      <div className={estilos.encabezado}>
        <h1 id="titulo-registro">Crea tu cuenta</h1>
        <p className={estilos.lema}>Con tu nombre, tu correo y tu teléfono basta.</p>
      </div>

      <form
        aria-labelledby="titulo-registro"
        className={estilos.formulario}
        onSubmit={handleSubmit((datos) => registro.mutate(datos))}
        noValidate
      >
        <Campo
          id="nombre"
          etiqueta="Tu nombre"
          icono="usuario"
          autoComplete="name"
          placeholder="Ej.: Luis Huamán"
          registro={register('nombre')}
          error={errors.nombre?.message}
        />
        <Campo
          id="correo"
          etiqueta="Correo"
          icono="correo"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="tucorreo@ejemplo.com"
          registro={register('correo')}
          error={errors.correo?.message}
        />
        <Campo
          id="telefono"
          etiqueta="Teléfono"
          icono="celular"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Ej.: 966 123 456"
          registro={register('telefono')}
          error={errors.telefono?.message}
        />
        <CampoContrasena
          id="contrasena"
          etiqueta="Contraseña"
          autoComplete="new-password"
          placeholder="Crea una contraseña"
          ayuda="Al menos 10 caracteres. Una frase fácil de recordar funciona bien."
          registro={register('contrasena')}
          error={errors.contrasena?.message}
          extra={<IndicadorFortaleza valor={contrasena} />}
        />
        <CasillaPolitica registro={register('aceptaPolitica')} error={errors.aceptaPolitica} />

        {registro.isError &&
          (correoConCuenta ? (
            <Alerta>
              Ya tienes una cuenta con ese correo:{' '}
              <Link to={`/b/${slug}/ingresar`} state={{ desde }}>
                inicia sesión
              </Link>{' '}
              para reservar aquí.
            </Alerta>
          ) : (
            <Alerta>{mensajeDeError(registro.error)}</Alerta>
          ))}

        <Boton type="submit" bloque cargando={registro.isPending} textoCargando="Creando tu cuenta…">
          Crear mi cuenta
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
