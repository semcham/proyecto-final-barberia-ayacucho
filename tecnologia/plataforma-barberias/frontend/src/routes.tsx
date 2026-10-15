import { createBrowserRouter, Link } from 'react-router-dom';
import Inicio from './pages/Inicio';
import Registro from './pages/Registro';

// Rutas de la aplicación. Las historias agregan aquí sus páginas: /ingresar y la protección de /app (US2),
// /app/usuarios y /activar (US4).

function Portada() {
  return (
    <main className="contenedor">
      <h1>Barberías Ayacucho</h1>
      <p>Gestiona tu barbería, tus barberos y tus citas desde el celular.</p>
      <p>
        <Link to="/registro">Registra tu barbería gratis</Link>
      </p>
    </main>
  );
}

function NoEncontrada() {
  return (
    <main className="contenedor">
      <h1>Página no encontrada</h1>
      <Link to="/">Volver al inicio</Link>
    </main>
  );
}

export const rutas = [
  { path: '/', element: <Portada /> },
  { path: '/registro', element: <Registro /> },
  { path: '/app', element: <Inicio /> },
  { path: '*', element: <NoEncontrada /> },
];

export const router = createBrowserRouter(rutas);
