import { Link, Route, Routes } from 'react-router-dom';
import { RutaProtegida } from './auth/RutaProtegida';
import { BarraSuperior } from './components/BarraSuperior';
import Ingresar from './pages/Ingresar';
import Inicio from './pages/Inicio';
import Registro from './pages/Registro';

// Rutas de la aplicación. US4 agregará /app/usuarios (solo PROPIETARIO) y /activar.
// Se usan <Routes> (no el router de datos): la aplicación no necesita loaders ni actions.

function Portada() {
  return (
    <main className="contenedor">
      <h1>Barberías Ayacucho</h1>
      <p>Gestiona tu barbería, tus barberos y tus citas desde el celular.</p>
      <p>
        <Link to="/registro">Registra tu barbería gratis</Link> · <Link to="/ingresar">Ingresar</Link>
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

export function RutasApp() {
  return (
    <Routes>
      <Route path="/" element={<Portada />} />
      <Route path="/registro" element={<Registro />} />
      <Route path="/ingresar" element={<Ingresar />} />
      <Route
        path="/app"
        element={
          <RutaProtegida>
            <BarraSuperior />
            <Inicio />
          </RutaProtegida>
        }
      />
      <Route path="*" element={<NoEncontrada />} />
    </Routes>
  );
}
