import { NavLink, useNavigate } from 'react-router-dom';
import { useSesion } from '../auth/SesionProvider';
import estilos from './BarraSuperior.module.css';

/** Barra de la aplicación: barbería, usuario, navegación según el rol y cierre de sesión. */
export function BarraSuperior() {
  const { usuario, cerrarSesion } = useSesion();
  const navegar = useNavigate();

  const salir = async () => {
    await cerrarSesion();
    navegar('/ingresar', { replace: true });
  };

  return (
    <header className={estilos.barra}>
      <div className={estilos.identidad}>
        <strong>{usuario?.barberia.nombre}</strong>
        <span>{usuario?.nombre}</span>
      </div>
      <nav className={estilos.navegacion} aria-label="Principal">
        <NavLink to="/app" end>
          Inicio
        </NavLink>
        {/* Solo una ayuda de navegación: el backend exige el rol en cada operación. */}
        {usuario?.rol === 'PROPIETARIO' && <NavLink to="/app/usuarios">Usuarios</NavLink>}
      </nav>
      <button type="button" onClick={salir}>
        Cerrar sesión
      </button>
    </header>
  );
}
