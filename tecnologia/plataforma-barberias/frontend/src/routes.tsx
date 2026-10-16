import { Link, Route, Routes } from 'react-router-dom';
import { RutaProtegida } from './auth/RutaProtegida';
import { DisenoApp } from './components/app/DisenoApp';
import { Icono } from './components/Icono';
import { Logo } from './components/Logo';
import { ProveedorAvisos } from './components/ui';
import Activar from './pages/Activar';
import Ingresar from './pages/Ingresar';
import Inicio from './pages/Inicio';
import Registro from './pages/Registro';
import estilos from './pages/Portada.module.css';
import Usuarios from './pages/Usuarios';

// Rutas de la aplicación. Se usan <Routes> (no el router de datos): la aplicación no necesita loaders ni actions.

function Portada() {
  return (
    <main className={estilos.portada}>
      <Logo />
      <div className={estilos.hero}>
        <p className="antetitulo">Software para barberías</p>
        <h1>Barberías Ayacucho</h1>
        <p className={estilos.bajada}>Gestiona tu barbería, tus barberos y tus citas desde el celular.</p>
        <div className={estilos.acciones}>
          <Link to="/registro" className="boton boton--primario">
            Registra tu barbería gratis
            <Icono nombre="flecha" tamano={18} />
          </Link>
          <Link to="/ingresar" className="boton boton--secundario">
            Ingresar
          </Link>
        </div>
      </div>
    </main>
  );
}

function NoEncontrada() {
  return (
    <main className={estilos.portada}>
      <Logo />
      <div className={estilos.hero}>
        <p className="antetitulo">Error 404</p>
        <h1>Página no encontrada</h1>
        <p className={estilos.bajada}>La dirección que abriste no existe o cambió.</p>
        <div className={estilos.acciones}>
          <Link to="/" className="boton boton--secundario">
            Volver al inicio
          </Link>
        </div>
      </div>
    </main>
  );
}

export function RutasApp() {
  return (
    <ProveedorAvisos>
      <Routes>
        <Route path="/" element={<Portada />} />
        <Route path="/registro" element={<Registro />} />
        <Route path="/ingresar" element={<Ingresar />} />
        <Route path="/activar" element={<Activar />} />
        <Route
          path="/app"
          element={
            <RutaProtegida>
              <DisenoApp />
            </RutaProtegida>
          }
        >
          <Route index element={<Inicio />} />
          <Route
            path="usuarios"
            element={
              <RutaProtegida roles={['PROPIETARIO']}>
                <Usuarios />
              </RutaProtegida>
            }
          />
        </Route>
        <Route path="*" element={<NoEncontrada />} />
      </Routes>
    </ProveedorAvisos>
  );
}
