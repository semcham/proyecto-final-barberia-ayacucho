import { NavLink, useNavigate } from 'react-router-dom';
import { useSesion } from '../auth/SesionProvider';
import { Icono } from './Icono';
import { iniciales } from './iniciales';
import estilos from './BarraSuperior.module.css';

/** Barra de la aplicación: barbería, usuario, navegación según el rol y cierre de sesión. */
export function BarraSuperior() {
  const { usuario, cerrarSesion } = useSesion();
  const navegar = useNavigate();

  const salir = async () => {
    await cerrarSesion();
    navegar('/ingresar', { replace: true });
  };

  const claseEnlace = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${estilos.enlace} ${estilos.activo}` : estilos.enlace;

  return (
    <header className={estilos.barra}>
      <div className={estilos.interior}>
        <div className={estilos.identidad}>
          <span className={estilos.sello}>
            <Icono nombre="tijeras" tamano={18} />
          </span>
          <div className={estilos.textos}>
            <strong>{usuario?.barberia.nombre}</strong>
            <span>{usuario?.rol === 'PROPIETARIO' ? 'Propietario' : 'Barbero'}</span>
          </div>
        </div>

        <nav className={estilos.navegacion} aria-label="Principal">
          <NavLink to="/app" end className={claseEnlace}>
            <Icono nombre="inicio" tamano={18} />
            Inicio
          </NavLink>
          {/* Solo una ayuda de navegación: el backend exige el rol en cada operación. */}
          {usuario?.rol === 'PROPIETARIO' && (
            <NavLink to="/app/usuarios" className={claseEnlace}>
              <Icono nombre="usuarios" tamano={18} />
              Usuarios
            </NavLink>
          )}
        </nav>

        <div className={estilos.cuenta}>
          <span className={estilos.avatar} aria-hidden="true">
            {iniciales(usuario?.nombre ?? '')}
          </span>
          <span className={estilos.nombre}>{usuario?.nombre}</span>
          <button
            type="button"
            className={`boton boton--fantasma boton--pequeno ${estilos.salir}`}
            onClick={salir}
          >
            <Icono nombre="salir" tamano={18} />
            <span className={estilos.textoSalir}>Cerrar sesión</span>
          </button>
        </div>
      </div>
    </header>
  );
}
