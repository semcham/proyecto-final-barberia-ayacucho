import { createBrowserRouter, Link } from 'react-router-dom';

// Rutas de la aplicación. Las historias agregan aquí sus páginas: /registro (US1), /ingresar (US2),
// /app (protegida, US2), /app/usuarios y /activar (US4).

function Portada() {
  return (
    <main className="contenedor">
      <h1>Barberías Ayacucho</h1>
      <p>Gestiona tu barbería, tus barberos y tus citas desde el celular.</p>
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
  { path: '*', element: <NoEncontrada /> },
];

export const router = createBrowserRouter(rutas);
