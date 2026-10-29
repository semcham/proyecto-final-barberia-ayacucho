import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { ApiError } from '../../api/client';
import { usePlataforma } from '../../auth/plataforma';
import { Alerta } from '../../components/ui/Alerta';
import { Boton } from '../../components/ui/Boton';
import { Campo, CampoContrasena } from '../../components/ui/Campo';
import { MarcoAcceso } from '../../components/MarcoAcceso';
import estilos from '../Acceso.module.css';

// T071 · Ingreso del administrador de la plataforma en dos pasos (R07): correo y contraseña, y luego el código
// de 6 dígitos de la aplicación de autenticación o uno de los códigos de recuperación.

const esquemaCredenciales = z.object({
  correo: z.string().trim().min(1, 'Ingresa tu correo.').max(254),
  contrasena: z.string().min(1, 'Ingresa tu contraseña.').max(200),
});
const esquemaCodigo = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'El código tiene 6 dígitos.'),
});
const esquemaRecuperacion = z.object({
  codigoRecuperacion: z
    .string()
    .trim()
    .min(10, 'Escribe el código de recuperación completo.')
    .max(20, 'Ese código es demasiado largo.'),
});

function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  }
  if (error.codigo === 'DEMASIADOS_INTENTOS') {
    const segundos = error.reintentarEnSegundos;
    if (!segundos) return 'Demasiados intentos. Espera unos minutos antes de volver a intentar.';
    const minutos = Math.ceil(segundos / 60);
    return `Demasiados intentos. Vuelve a intentar en ${minutos} ${minutos === 1 ? 'minuto' : 'minutos'}.`;
  }
  return error.message;
}

function PasoCredenciales({ alContinuar }: { alContinuar: (desafio: string) => void }) {
  const { ingresar } = usePlataforma();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof esquemaCredenciales>>({ resolver: zodResolver(esquemaCredenciales) });

  const enviar = handleSubmit(async ({ correo, contrasena }) => {
    setError(null);
    try {
      alContinuar(await ingresar(correo, contrasena));
    } catch (causa) {
      setError(mensajeDeError(causa));
    }
  });

  return (
    <form className={estilos.formulario} onSubmit={enviar} noValidate aria-label="Correo y contraseña">
      <Campo
        id="correo"
        etiqueta="Correo"
        icono="correo"
        type="email"
        inputMode="email"
        autoComplete="username"
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
      <Boton type="submit" bloque cargando={isSubmitting} textoCargando="Verificando…">
        Continuar
      </Boton>
    </form>
  );
}

function PasoCodigo({ desafio, alVolver }: { desafio: string; alVolver: () => void }) {
  const { verificar } = usePlataforma();
  const [conRecuperacion, setConRecuperacion] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formularioCodigo = useForm<z.infer<typeof esquemaCodigo>>({ resolver: zodResolver(esquemaCodigo) });
  const formularioRecuperacion = useForm<z.infer<typeof esquemaRecuperacion>>({
    resolver: zodResolver(esquemaRecuperacion),
  });

  const intentar = async (codigo: Parameters<typeof verificar>[1]) => {
    setError(null);
    try {
      await verificar(desafio, codigo);
    } catch (causa) {
      setError(mensajeDeError(causa));
    } finally {
      // El código nunca queda escrito en el formulario después de enviarlo.
      formularioCodigo.reset();
      formularioRecuperacion.reset();
    }
  };

  const cambiar = () => {
    setError(null);
    setConRecuperacion((actual) => !actual);
  };

  return (
    <div className={estilos.formulario}>
      {conRecuperacion ? (
        <form
          className={estilos.formulario}
          aria-label="Código de recuperación"
          noValidate
          onSubmit={formularioRecuperacion.handleSubmit(({ codigoRecuperacion }) =>
            intentar({ codigoRecuperacion }),
          )}
        >
          <Campo
            id="codigoRecuperacion"
            etiqueta="Código de recuperación"
            icono="candado"
            autoComplete="off"
            ayuda="Uno de los 10 códigos que recibiste al crear la cuenta. Cada uno sirve una sola vez."
            registro={formularioRecuperacion.register('codigoRecuperacion')}
            error={formularioRecuperacion.formState.errors.codigoRecuperacion?.message}
          />
          {error && <Alerta>{error}</Alerta>}
          <Boton
            type="submit"
            bloque
            cargando={formularioRecuperacion.formState.isSubmitting}
            textoCargando="Verificando…"
          >
            Ingresar con el código de recuperación
          </Boton>
        </form>
      ) : (
        <form
          className={estilos.formulario}
          aria-label="Código de verificación"
          noValidate
          onSubmit={formularioCodigo.handleSubmit(({ codigo }) => intentar({ codigo }))}
        >
          <Campo
            id="codigo"
            etiqueta="Código de 6 dígitos"
            icono="escudo"
            inputMode="numeric"
            autoComplete="one-time-code"
            enterKeyHint="done"
            ayuda="Ábrelo en tu aplicación de autenticación. Cambia cada 30 segundos."
            registro={formularioCodigo.register('codigo')}
            error={formularioCodigo.formState.errors.codigo?.message}
          />
          {error && <Alerta>{error}</Alerta>}
          <Boton
            type="submit"
            bloque
            cargando={formularioCodigo.formState.isSubmitting}
            textoCargando="Verificando…"
          >
            Ingresar
          </Boton>
        </form>
      )}
      <Boton type="button" variante="fantasma" bloque onClick={cambiar}>
        {conRecuperacion ? 'Usar el código de la aplicación' : 'Usar un código de recuperación'}
      </Boton>
      <Boton type="button" variante="fantasma" bloque onClick={alVolver}>
        Volver a empezar
      </Boton>
    </div>
  );
}

/** /plataforma/ingresar · Ingreso del administrador de la plataforma. */
export default function IngresarPlataforma() {
  const { estado } = usePlataforma();
  const desde = (useLocation().state as { desde?: string } | null)?.desde ?? '/plataforma';
  const [desafio, setDesafio] = useState<string | null>(null);

  if (estado === 'autenticado') return <Navigate to={desde} replace />;

  return (
    <MarcoAcceso
      antetitulo="Administración de la plataforma"
      titular="Acceso protegido con segundo factor"
      descripcion="Esta cuenta aprueba pagos y activa planes: además de la contraseña, pide un código de tu aplicación de autenticación."
    >
      <div className={estilos.encabezado}>
        <h1>{desafio ? 'Código de verificación' : 'Ingreso del administrador'}</h1>
        <p className={estilos.lema}>
          {desafio ? 'Escribe el código que muestra tu aplicación.' : 'Usa tu correo y tu contraseña.'}
        </p>
      </div>
      {desafio ? (
        <PasoCodigo key={desafio} desafio={desafio} alVolver={() => setDesafio(null)} />
      ) : (
        <PasoCredenciales alContinuar={setDesafio} />
      )}
    </MarcoAcceso>
  );
}
