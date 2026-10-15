import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, llamarApi, tokenEnMemoria } from '../api/client';
import type { components } from '../api/schema';
import { VERSION_POLITICA_DATOS, VERSION_TERMINOS } from '../legal';
import estilos from './Registro.module.css';

type RespuestaRegistro = components['schemas']['RegistroBarberiaResponse'];
type SolicitudRegistro = components['schemas']['RegistroBarberiaRequest'];

/** Estado que recibe /app tras el registro (hasta que exista la sesión completa de US2). */
export interface EstadoBienvenida {
  barberia: RespuestaRegistro['barberia'];
  suscripcion: RespuestaRegistro['suscripcion'];
}

// Mismas reglas que el contrato y el dominio; el servidor vuelve a validar todo (la interfaz solo ayuda).
const esquema = z.object({
  nombreBarberia: z
    .string()
    .trim()
    .min(2, 'Ingresa el nombre de tu barbería (al menos 2 caracteres).')
    .max(120, 'El nombre no puede pasar de 120 caracteres.'),
  nombre: z
    .string()
    .trim()
    .min(2, 'Ingresa tu nombre (al menos 2 caracteres).')
    .max(120, 'El nombre no puede pasar de 120 caracteres.'),
  correo: z.string().trim().max(254).email('Ingresa un correo válido.'),
  contrasena: z
    .string()
    .min(10, 'La contraseña debe tener al menos 10 caracteres.')
    .max(128, 'La contraseña no puede pasar de 128 caracteres.'),
  aceptaTerminos: z.literal(true, { errorMap: () => ({ message: 'Debes aceptar los términos de uso.' }) }),
  aceptaPolitica: z.literal(true, {
    errorMap: () => ({ message: 'Debes aceptar la política de tratamiento de datos.' }),
  }),
});

type Formulario = z.infer<typeof esquema>;

const MENSAJE_POR_CAMPO: Record<string, string> = {
  'propietario.correo': 'Revisa el correo.',
  'propietario.contrasena':
    'Elige una contraseña más segura: más larga, que no sea común ni contenga tu correo.',
  'propietario.nombre': 'Revisa tu nombre.',
  nombreBarberia: 'Revisa el nombre de la barbería.',
  'aceptaciones.terminosVersion': 'Los términos cambiaron. Recarga la página y vuelve a aceptarlos.',
  'aceptaciones.politicaDatosVersion': 'La política de datos cambió. Recarga la página y vuelve a aceptarla.',
};

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError))
    return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  if (error.codigo === 'VALIDACION') {
    const campo = error.detalles.map((detalle) => String(detalle.campo)).find((c) => c in MENSAJE_POR_CAMPO);
    if (campo) return MENSAJE_POR_CAMPO[campo];
  }
  return error.message;
}

/** Registro de la barbería con prueba gratuita (HU02, RF01, RF18). No pide datos de pago (FR-004). */
export default function Registro() {
  const navegar = useNavigate();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), mode: 'onSubmit' });

  const registro = useMutation({
    mutationFn: (datos: Formulario) =>
      llamarApi<RespuestaRegistro>('/barberias', {
        metodo: 'POST',
        sinRenovar: true,
        cuerpo: {
          nombreBarberia: datos.nombreBarberia,
          propietario: { nombre: datos.nombre, correo: datos.correo, contrasena: datos.contrasena },
          aceptaciones: { terminosVersion: VERSION_TERMINOS, politicaDatosVersion: VERSION_POLITICA_DATOS },
        } satisfies SolicitudRegistro,
      }),
    onSuccess: (respuesta) => {
      tokenEnMemoria.fijar(respuesta.sesion.tokenAcceso);
      const estado: EstadoBienvenida = { barberia: respuesta.barberia, suscripcion: respuesta.suscripcion };
      navegar('/app', { replace: true, state: estado });
    },
  });

  return (
    <main className="contenedor">
      <h1>Registra tu barbería</h1>
      <p className={estilos.lema}>Empieza tu prueba gratuita de 14 días, sin tarjeta.</p>

      <form
        className={estilos.formulario}
        onSubmit={handleSubmit((datos) => registro.mutate(datos))}
        noValidate
      >
        <div className={estilos.campo}>
          <label htmlFor="nombreBarberia">Nombre de la barbería</label>
          <input id="nombreBarberia" autoComplete="organization" {...register('nombreBarberia')} />
          {errors.nombreBarberia && <p className="mensaje-error">{errors.nombreBarberia.message}</p>}
        </div>

        <div className={estilos.campo}>
          <label htmlFor="nombre">Tu nombre</label>
          <input id="nombre" autoComplete="name" {...register('nombre')} />
          {errors.nombre && <p className="mensaje-error">{errors.nombre.message}</p>}
        </div>

        <div className={estilos.campo}>
          <label htmlFor="correo">Correo</label>
          <input id="correo" type="email" inputMode="email" autoComplete="email" {...register('correo')} />
          {errors.correo && <p className="mensaje-error">{errors.correo.message}</p>}
        </div>

        <div className={estilos.campo}>
          <label htmlFor="contrasena">Contraseña</label>
          <input id="contrasena" type="password" autoComplete="new-password" {...register('contrasena')} />
          <p className={estilos.ayuda}>Al menos 10 caracteres. Una frase fácil de recordar funciona bien.</p>
          {errors.contrasena && <p className="mensaje-error">{errors.contrasena.message}</p>}
        </div>

        <div className={estilos.casilla}>
          <input id="aceptaTerminos" type="checkbox" {...register('aceptaTerminos')} />
          <label htmlFor="aceptaTerminos">Acepto los términos de uso (versión {VERSION_TERMINOS})</label>
        </div>
        {errors.aceptaTerminos && <p className="mensaje-error">{errors.aceptaTerminos.message}</p>}

        <div className={estilos.casilla}>
          <input id="aceptaPolitica" type="checkbox" {...register('aceptaPolitica')} />
          <label htmlFor="aceptaPolitica">
            Acepto la política de tratamiento de datos (versión {VERSION_POLITICA_DATOS})
          </label>
        </div>
        {errors.aceptaPolitica && <p className="mensaje-error">{errors.aceptaPolitica.message}</p>}

        {registro.isError && (
          <p role="alert" className="mensaje-error">
            {mensajeDeError(registro.error)}
          </p>
        )}

        <button type="submit" disabled={registro.isPending}>
          {registro.isPending ? 'Creando tu barbería…' : 'Crear mi barbería'}
        </button>
      </form>

      <p className={estilos.pie}>
        ¿Ya tienes cuenta? <Link to="/ingresar">Ingresa aquí</Link>
      </p>
    </main>
  );
}
