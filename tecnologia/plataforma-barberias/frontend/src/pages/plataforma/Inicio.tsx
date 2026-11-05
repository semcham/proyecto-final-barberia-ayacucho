import { Link } from 'react-router-dom';
import { EncabezadoPagina } from '../../components/app/EncabezadoPagina';
import { Icono, type NombreIcono } from '../../components/Icono';
import { Tarjeta } from '../../components/ui';
import estilos from '../Inicio.module.css';

/** Las tres secciones del administrador, con qué se hace en cada una (los mismos destinos del menú). */
const ACCESOS: { a: string; icono: NombreIcono; titulo: string; texto: string }[] = [
  {
    a: '/plataforma/comprobantes',
    icono: 'documento',
    titulo: 'Comprobantes',
    texto: 'Revisa las transferencias y apruébalas o recházalas.',
  },
  {
    a: '/plataforma/pagos-por-revisar',
    icono: 'alerta',
    titulo: 'Pagos por revisar',
    texto: 'Casos que el sistema no resolvió solo: duplicados, devoluciones e importes distintos.',
  },
  {
    a: '/plataforma/barberias',
    icono: 'tienda',
    titulo: 'Barberías',
    texto: 'Estado de cada barbería y su suscripción; suspender, reactivar o activar un plan.',
  },
];

/** /plataforma · Inicio del administrador: lleva a comprobantes (US3), pagos por revisar (US4) y barberías (US5). */
export default function InicioPlataforma() {
  return (
    <>
      <EncabezadoPagina
        migas={[{ etiqueta: 'Plataforma' }]}
        antetitulo="Administración"
        titulo="Panel de la plataforma"
        descripcion="Elige qué revisar. Cada acción queda en la auditoría de la barbería."
      />
      <section aria-labelledby="titulo-accesos-plataforma">
        <h2 id="titulo-accesos-plataforma" className={estilos.tituloSeccion}>
          Qué revisar
        </h2>
        <div className={estilos.accesos}>
          {ACCESOS.map((acceso) => (
            <Link
              key={acceso.a}
              to={acceso.a}
              className={`tarjeta ${estilos.acceso} ${estilos.accesoEnlace}`}
            >
              <span className={estilos.iconoTarjeta}>
                <Icono nombre={acceso.icono} />
              </span>
              <span className={estilos.accesoTexto}>
                <strong>{acceso.titulo}</strong>
                <span>{acceso.texto}</span>
              </span>
              <span className={estilos.flecha}>
                <Icono nombre="flecha" tamano={18} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <div className={estilos.seccion}>
        <Tarjeta titulo="Tu sesión" icono="escudo">
          <p>
            Entraste con tu contraseña y un código de verificación. La sesión dura como máximo 8 horas;
            después tendrás que volver a ingresar con un código nuevo.
          </p>
          <p>Cuando termines, usa «Salir»: cierra la sesión en todos los servidores de la plataforma.</p>
        </Tarjeta>
      </div>
    </>
  );
}
