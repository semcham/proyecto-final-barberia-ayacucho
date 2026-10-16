import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ApiError, llamarApi } from '../api/client';
import { useSesion } from '../auth/SesionProvider';
import type { components } from '../api/schema';
import { VERSION_POLITICA_DATOS, VERSION_TERMINOS } from '../legal';
import { Alerta } from '../components/ui/Alerta';
import { Boton } from '../components/ui/Boton';
import { Campo, CampoContrasena } from '../components/ui/Campo';
import { Icono } from '../components/Icono';
import { IndicadorFortaleza } from '../components/IndicadorFortaleza';
import { MarcoAcceso, type PuntoValor } from '../components/MarcoAcceso';
import estilos from './Acceso.module.css';

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

const PUNTOS_VALOR: PuntoValor[] = [
  {
    icono: 'celular',
    titulo: 'Todo desde tu celular',
    texto: 'Gestiona tu barbería desde donde estés, sin instalar nada.',
  },
  {
    icono: 'usuarios',
    titulo: 'Tu equipo, cada uno con su acceso',
    texto: 'Crea cuentas para tus barberos y decide quién puede entrar.',
  },
  {
    icono: 'escudo',
    titulo: 'Tus datos, solo tuyos',
    texto: 'La información de tu barbería está separada de la de las demás.',
  },
];

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
  const { establecer } = useSesion();
  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<Formulario>({ resolver: zodResolver(esquema), mode: 'onSubmit' });
  const contrasena = useWatch({ control, name: 'contrasena' }) ?? '';

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
      establecer(respuesta.sesion);
      const estado: EstadoBienvenida = { barberia: respuesta.barberia, suscripcion: respuesta.suscripcion };
      navegar('/app', { replace: true, state: estado });
    },
  });

  return (
    <MarcoAcceso
      antetitulo="Prueba gratuita"
      titular="14 días gratis para ordenar tu barbería"
      descripcion="Sin tarjeta y sin compromiso. Crea tu cuenta en un minuto y empieza hoy mismo."
      puntos={PUNTOS_VALOR}
      pie={
        <p>
          ¿Ya tienes cuenta? <Link to="/ingresar">Ingresa aquí</Link>
        </p>
      }
    >
      <div className={estilos.encabezado}>
        <h1>Registra tu barbería</h1>
        <p className={estilos.lema}>
          <Icono nombre="tarjetaTachada" tamano={18} />
          Empieza tu prueba gratuita de 14 días, sin tarjeta.
        </p>
      </div>

      <form
        className={estilos.formulario}
        onSubmit={handleSubmit((datos) => registro.mutate(datos))}
        noValidate
      >
        <Campo
          id="nombreBarberia"
          etiqueta="Nombre de la barbería"
          icono="tienda"
          autoComplete="organization"
          placeholder="Ej.: Barbería Huamanga"
          registro={register('nombreBarberia')}
          error={errors.nombreBarberia?.message}
        />

        <Campo
          id="nombre"
          etiqueta="Tu nombre"
          icono="usuario"
          autoComplete="name"
          placeholder="Ej.: Rosa Quispe"
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

        <CampoContrasena
          id="contrasena"
          etiqueta="Contraseña"
          autoComplete="new-password"
          placeholder="Crea una contraseña"
          registro={register('contrasena')}
          ayuda="Al menos 10 caracteres. Una frase fácil de recordar funciona bien."
          error={errors.contrasena?.message}
          extra={<IndicadorFortaleza valor={contrasena} />}
        />

        <fieldset className={estilos.aceptaciones}>
          <legend className="sr-only">Aceptaciones</legend>
          <label className="casilla">
            <input
              id="aceptaTerminos"
              type="checkbox"
              aria-invalid={errors.aceptaTerminos ? true : undefined}
              aria-describedby={errors.aceptaTerminos ? 'aceptaTerminos-error' : undefined}
              {...register('aceptaTerminos')}
            />
            <span>Acepto los términos de uso (versión {VERSION_TERMINOS})</span>
          </label>
          {errors.aceptaTerminos && (
            <p id="aceptaTerminos-error" className="mensaje-error">
              <Icono nombre="alerta" tamano={16} />
              {errors.aceptaTerminos.message}
            </p>
          )}

          <label className="casilla">
            <input
              id="aceptaPolitica"
              type="checkbox"
              aria-invalid={errors.aceptaPolitica ? true : undefined}
              aria-describedby={errors.aceptaPolitica ? 'aceptaPolitica-error' : undefined}
              {...register('aceptaPolitica')}
            />
            <span>Acepto la política de tratamiento de datos (versión {VERSION_POLITICA_DATOS})</span>
          </label>
          {errors.aceptaPolitica && (
            <p id="aceptaPolitica-error" className="mensaje-error">
              <Icono nombre="alerta" tamano={16} />
              {errors.aceptaPolitica.message}
            </p>
          )}
        </fieldset>

        {registro.isError && <Alerta>{mensajeDeError(registro.error)}</Alerta>}

        <Boton
          type="submit"
          bloque
          cargando={registro.isPending}
          textoCargando="Creando tu barbería…"
          iconoFinal="flecha"
        >
          Crear mi barbería
        </Boton>
      </form>
    </MarcoAcceso>
  );
}
