import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ApiError } from '../../api/client';
import { mensajeDeErrorDeCuenta, verificarCorreo } from '../../api/cuenta';
import { useSesion } from '../../auth/SesionProvider';
import { Logo } from '../../components/Logo';
import { Alerta } from '../../components/ui/Alerta';
import { Boton, clasesBoton } from '../../components/ui/Boton';
import estilos from './Verificar.module.css';

/**
 * T062 de 010 · Verificar el correo con el enlace del correo: `/verificar#<token>` (contracts/pantallas.md; research
 * R09). El token llega en el FRAGMENTO (no viaja al servidor ni en Referer): se lee una vez, se quita de la dirección
 * y vive solo en memoria. Abrir la página NO gasta el enlace (FR-004): solo el botón "Verificar mi correo" lo envía.
 * Con éxito, lleva a la barbería donde se registró; un enlace que no sirve muestra un mensaje neutro.
 */
export default function Verificar() {
  const ubicacion = useLocation();
  const navegar = useNavigate();
  const { estado, refrescarUsuario } = useSesion();
  const [token] = useState(() => decodeURIComponent(ubicacion.hash.replace(/^#/, '')) || null);

  useEffect(() => {
    // Quita el token de la dirección (y del historial: replace) apenas se lee.
    if (ubicacion.hash) navegar(ubicacion.pathname, { replace: true });
  }, [ubicacion.hash, ubicacion.pathname, navegar]);

  const verificar = useMutation({
    mutationFn: () => verificarCorreo(token as string),
    onSuccess: async () => {
      // Si este navegador tiene la sesión del cliente, que deje de mostrar el aviso sin recargar.
      if (estado === 'autenticado') await refrescarUsuario().catch(() => null);
    },
  });

  // Un 400 (token fuera de largo) es, para la persona, otro enlace que no sirve.
  const noValido =
    !token ||
    (verificar.error instanceof ApiError &&
      (verificar.error.codigo === 'ENLACE_NO_VALIDO' || verificar.error.estado === 400));

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo compacto />
      </header>
      {verificar.isSuccess ? (
        <section className={estilos.bloque} aria-labelledby="titulo-verificado">
          <h1 id="titulo-verificado">Tu correo está verificado</h1>
          <Alerta tono="exito">Listo. Ya puedes reservar, usar el asistente y pagar tus adelantos.</Alerta>
          <Link
            to={`/b/${encodeURIComponent(verificar.data.barberia)}`}
            className={clasesBoton({ variante: 'primario' })}
          >
            Ir a la barbería
          </Link>
        </section>
      ) : noValido ? (
        <section className={estilos.bloque} aria-labelledby="titulo-no-valido">
          <h1 id="titulo-no-valido">Este enlace ya no es válido</h1>
          <p className={estilos.ayuda}>
            Puede que ya lo hayas usado, que hayan pasado sus 24 horas o que hayas pedido otro más nuevo. Para
            recibir uno nuevo, ingresa desde el enlace de tu barbería y pulsa{' '}
            <strong>Reenviar correo de verificación</strong>.
          </p>
          <Link to="/mis-citas" className={clasesBoton({ variante: 'secundario' })}>
            Ingresar
          </Link>
        </section>
      ) : (
        <section className={estilos.bloque} aria-labelledby="titulo-verificar">
          <h1 id="titulo-verificar">Verifica tu correo</h1>
          <p className={estilos.ayuda}>
            Pulsa el botón para confirmar que este correo es tuyo. Así podrás reservar en tu barbería.
          </p>
          {verificar.isError && <Alerta>{mensajeDeErrorDeCuenta(verificar.error)}</Alerta>}
          <Boton
            type="button"
            icono="check"
            cargando={verificar.isPending}
            textoCargando="Verificando…"
            onClick={() => verificar.mutate()}
          >
            Verificar mi correo
          </Boton>
        </section>
      )}
    </main>
  );
}
