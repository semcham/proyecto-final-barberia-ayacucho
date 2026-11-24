import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { correoConParteOculta, mensajeDeErrorDeCuenta, reenviarVerificacion } from '../../api/cuenta';
import { useSesion } from '../../auth/SesionProvider';
import { Icono } from '../Icono';
import { Alerta } from '../ui/Alerta';
import { Boton } from '../ui/Boton';
import estilos from './AvisoVerificacion.module.css';

/**
 * T063 de 010 · Aviso de verificación pendiente (FR-011; research R06; contracts/pantallas.md). Lo muestran la
 * reserva, el asistente y el pago del adelanto cuando `usuario.correoVerificado` es false o llega un 403
 * CORREO_NO_VERIFICADO. Ofrece reenviar el correo (respuesta neutra o el tiempo de espera) y comprobar de nuevo, por si
 * la persona ya verificó en otro dispositivo. No toca la selección de la pantalla que lo muestra.
 */
export function AvisoVerificacion({
  accion,
  alVerificar,
}: {
  /** Lo que la persona quiere hacer: "reservar", "usar el asistente", "pagar el adelanto". */
  accion: string;
  /** Se llama cuando la comprobación muestra el correo ya verificado. */
  alVerificar?: () => void;
}) {
  const { usuario, refrescarUsuario } = useSesion();
  const [sigueSinVerificar, setSigueSinVerificar] = useState(false);
  const reenvio = useMutation({ mutationFn: reenviarVerificacion });
  const comprobacion = useMutation({
    mutationFn: refrescarUsuario,
    onSuccess: (actual) => {
      if (actual?.correoVerificado) alVerificar?.();
      else setSigueSinVerificar(true);
    },
  });

  return (
    <section className={estilos.aviso} aria-labelledby="titulo-aviso-verificacion">
      <div className={estilos.encabezado}>
        <Icono nombre="correo" tamano={22} />
        <h2 id="titulo-aviso-verificacion">Verifica tu correo para {accion}</h2>
      </div>
      <p className={estilos.texto}>
        Te enviamos un enlace a{' '}
        <strong>{usuario ? correoConParteOculta(usuario.correo) : 'tu correo'}</strong>. Ábrelo y pulsa
        «Verificar mi correo». El enlace vale 24 horas.
      </p>
      {reenvio.isSuccess && <Alerta tono="exito">Te enviamos un correo nuevo.</Alerta>}
      {reenvio.isError && <Alerta>{mensajeDeErrorDeCuenta(reenvio.error)}</Alerta>}
      {sigueSinVerificar && !comprobacion.isPending && (
        <p role="status" className={estilos.texto}>
          Aún no vemos tu correo verificado. Abre el enlace del correo más reciente.
        </p>
      )}
      <div className={estilos.acciones}>
        <Boton
          type="button"
          variante="secundario"
          icono="correo"
          cargando={reenvio.isPending}
          textoCargando="Enviando…"
          onClick={() => reenvio.mutate()}
        >
          Reenviar correo de verificación
        </Boton>
        <Boton
          type="button"
          variante="secundario"
          icono="recargar"
          cargando={comprobacion.isPending}
          textoCargando="Comprobando…"
          onClick={() => comprobacion.mutate()}
        >
          Ya lo verifiqué
        </Boton>
      </div>
    </section>
  );
}
