import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { PantallaCarga } from './PantallaCarga';
import { type RolSesion, useSesion } from './SesionProvider';

/** Pantalla de inicio de cada rol: el panel para el personal y sus citas para el cliente (002). */
export function inicioDelRol(rol: RolSesion): string {
  return rol === 'CLIENTE' ? '/mis-citas' : '/app';
}

/**
 * Muestra su contenido solo con sesión iniciada; si no, lleva a /ingresar. Con `roles`, además exige uno de
 * esos roles; si no lo tiene, lleva al inicio de su rol. Es solo una ayuda de navegación: los permisos
 * reales los aplica el backend.
 */
export function RutaProtegida({ children, roles }: { children: ReactNode; roles?: RolSesion[] }) {
  const { estado, usuario } = useSesion();
  const ubicacion = useLocation();

  if (estado === 'cargando') {
    return <PantallaCarga />;
  }
  if (estado === 'anonimo' || !usuario) {
    return <Navigate to="/ingresar" replace state={{ desde: ubicacion.pathname }} />;
  }
  if (roles && !roles.includes(usuario.rol)) {
    return <Navigate to={inicioDelRol(usuario.rol)} replace />;
  }
  return <>{children}</>;
}
