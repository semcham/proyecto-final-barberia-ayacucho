import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Tarjeta } from '../../components/ui';

/** /plataforma · Inicio del administrador: lleva a comprobantes (US3), pagos por revisar (US4) y barberías (US5). */
export default function InicioPlataforma() {
  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Plataforma' }]}
        antetitulo="Administración"
        titulo="Panel de la plataforma"
        descripcion="Revisa los comprobantes de transferencia en «Comprobantes», los casos pendientes en «Pagos por revisar» y el estado de cada barbería y su suscripción en «Barberías»."
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
