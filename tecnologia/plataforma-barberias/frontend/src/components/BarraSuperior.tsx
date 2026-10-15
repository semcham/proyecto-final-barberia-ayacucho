import { useNavigate } from 'react-router-dom';
import { useSesion } from '../auth/SesionProvider';
import estilos from './BarraSuperior.module.css';

/** Barra de la aplicación con la barbería, el usuario y el cierre de sesión. */
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
      <button type="button" onClick={salir}>
        Cerrar sesión
      </button>
    </header>
  );
}
