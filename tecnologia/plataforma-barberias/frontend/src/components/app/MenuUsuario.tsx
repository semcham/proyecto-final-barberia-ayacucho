import { useNavigate } from 'react-router-dom';
import { useSesion } from '../../auth/SesionProvider';
import { Icono } from '../Icono';
import { iniciales } from '../iniciales';
import {
  clasesBoton,
  Menu,
  MenuContenido,
  MenuDisparador,
  MenuEtiqueta,
  MenuItem,
  MenuSeparador,
} from '../ui';
import estilos from './MenuUsuario.module.css';

/** Menú de la persona con sesión: nombre, rol, correo y cierre de sesión. */
export function MenuUsuario() {
  const { usuario, cerrarSesion } = useSesion();
  const navegar = useNavigate();
  const rol = usuario?.rol === 'PROPIETARIO' ? 'Propietario' : 'Barbero';

  const salir = async () => {
    await cerrarSesion();
    navegar('/ingresar', { replace: true });
  };

  return (
    <Menu>
      <MenuDisparador
        className={clasesBoton({ variante: 'fantasma', tamano: 'sm', className: estilos.disparador })}
      >
        <span className={estilos.avatar} aria-hidden="true">
          {iniciales(usuario?.nombre ?? '')}
        </span>
        <span className={estilos.textos}>
          <span className={estilos.nombre}>{usuario?.nombre}</span>
          <span className={estilos.rol}>{rol}</span>
        </span>
        <span className={estilos.flecha}>
          <Icono nombre="chevronAbajo" tamano={14} />
        </span>
      </MenuDisparador>
      <MenuContenido>
        <MenuEtiqueta className={estilos.resumen}>
          <span className={estilos.resumenNombre}>{usuario?.nombre}</span>
          <span className={estilos.resumenCorreo}>{usuario?.correo}</span>
          <span className={estilos.resumenRol}>
            {rol} · {usuario?.barberia.nombre}
          </span>
        </MenuEtiqueta>
        <MenuSeparador />
        <MenuItem icono="salir" peligro onSelect={() => void salir()}>
          Cerrar sesión
        </MenuItem>
      </MenuContenido>
    </Menu>
  );
}
