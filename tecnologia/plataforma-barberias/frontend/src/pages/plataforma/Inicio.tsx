import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Tarjeta } from '../../components/ui';

/** /plataforma · Inicio del administrador. Las secciones de comprobantes y barberías llegan con US3 y US5. */
export default function InicioPlataforma() {
  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Plataforma' }]}
        antetitulo="Administración"
        titulo="Panel de la plataforma"
        descripcion="Desde aquí revisarás los comprobantes de transferencia y gestionarás las barberías y sus suscripciones."
      />
      <Tarjeta titulo="Tu sesión" icono="escudo">
        <p>
          Entraste con tu contraseña y un código de verificación. La sesión dura como máximo 8 horas; después
          tendrás que volver a ingresar con un código nuevo.
        </p>
        <p>Cuando termines, usa «Salir»: cierra la sesión en todos los servidores de la plataforma.</p>
      </Tarjeta>
    </>
  );
}
