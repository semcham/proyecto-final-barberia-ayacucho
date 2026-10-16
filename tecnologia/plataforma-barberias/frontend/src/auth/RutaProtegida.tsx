import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { type UsuarioActual, useSesion } from './SesionProvider';

/**
 * Muestra su contenido solo con sesión iniciada; si no, lleva a /ingresar. Con `roles`, además exige uno de
 * esos roles. Es solo una ayuda de navegación: los permisos reales los aplica el backend.
 */
export function RutaProtegida({ children, roles }: { children: ReactNode; roles?: UsuarioActual['rol'][] }) {
  const { estado, usuario } = useSesion();
  const ubicacion = useLocation();

  if (estado === 'cargando') {
    return (
      <main className="contenedor cargando" aria-busy="true">
        <span className="girador" aria-hidden="true" />
        <p>Cargando…</p>
      </main>
    );
  }
  if (estado === 'anonimo' || !usuario) {
    return <Navigate to="/ingresar" replace state={{ desde: ubicacion.pathname }} />;
  }
  if (roles && !roles.includes(usuario.rol)) {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
}
