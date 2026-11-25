import { Link, useNavigate } from 'react-router-dom';
import { correoConParteOculta } from '../../api/cuenta';
import { useSesion } from '../../auth/SesionProvider';
import { AvisoVerificacion } from '../../components/app/AvisoVerificacion';
import { Icono, type NombreIcono } from '../../components/Icono';
import { iniciales } from '../../components/iniciales';
import { Boton, ConmutadorTema, EtiquetaEstado } from '../../components/ui';
import { EncabezadoCliente } from './EncabezadoCliente';
import estilos from './MiCuenta.module.css';

const OPCIONES: { a: string; titulo: string; descripcion: string; icono: NombreIcono }[] = [
  {
    a: '/mis-datos',
    titulo: 'Mis datos',
    descripcion: 'Pide acceso, corrección o eliminación de tus datos personales.',
    icono: 'documento',
  },
  {
    a: '/mis-avisos',
    titulo: 'Cómo recibo mis avisos',
    descripcion: 'Elige si te avisamos de tus citas por correo o por WhatsApp.',
    icono: 'correo',
  },
];

/**
 * "Mi cuenta" del cliente (rediseño del 2026-11-24): su nombre, su correo (con parte oculta) y si está verificado, y
 * los accesos a Mis datos y a Cómo recibo mis avisos. Solo navegación: cada pantalla sigue con sus propias reglas.
 */
export default function MiCuenta() {
  const { usuario, cerrarSesion } = useSesion();
  const navegar = useNavigate();
  if (!usuario) return null;
  const verificado = usuario.correoVerificado !== false;

  return (
    <div className={estilos.pagina}>
      <EncabezadoCliente titulo="Mi cuenta" descripcion={`Tu cuenta en ${usuario.barberia.nombre}.`} />

      <section className={estilos.perfil} aria-label="Tu perfil">
        <span className={estilos.avatar} aria-hidden="true">
          {iniciales(usuario.nombre)}
        </span>
        <div className={estilos.perfilTextos}>
          <p className={estilos.nombre}>{usuario.nombre}</p>
          <p className={estilos.correo}>{correoConParteOculta(usuario.correo)}</p>
          <EtiquetaEstado tono={verificado ? 'exito' : 'aviso'}>
            {verificado ? 'Correo verificado' : 'Correo sin verificar'}
          </EtiquetaEstado>
        </div>
      </section>

      {!verificado && <AvisoVerificacion accion="reservar" />}

      <ul className={estilos.opciones}>
        {OPCIONES.map((o) => (
          <li key={o.a}>
            <Link to={o.a} className={estilos.opcion}>
              <span className={estilos.opcionIcono}>
                <Icono nombre={o.icono} tamano={22} />
              </span>
              <span className={estilos.opcionTextos}>
                <span className={estilos.opcionTitulo}>{o.titulo}</span>
                <span className={estilos.opcionDescripcion}>{o.descripcion}</span>
              </span>
              <Icono nombre="chevronDerecha" tamano={18} />
            </Link>
          </li>
        ))}
      </ul>

      <section className={estilos.apariencia} aria-labelledby="titulo-apariencia">
        <div>
          <h2 id="titulo-apariencia">Apariencia</h2>
          <p>Claro, oscuro o como tu sistema.</p>
        </div>
        <ConmutadorTema tamano="md" />
      </section>

      <div>
        <Boton
          type="button"
          variante="secundario"
          icono="salir"
          onClick={() =>
            void cerrarSesion().then(() => navegar(`/b/${usuario.barberia.slug}`, { replace: true }))
          }
        >
          Cerrar sesión
        </Boton>
      </div>
    </div>
  );
}
