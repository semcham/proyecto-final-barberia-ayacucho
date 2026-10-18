import { lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { PantallaCarga } from './auth/PantallaCarga';
import { RutaProtegida } from './auth/RutaProtegida';
import { Icono } from './components/Icono';
import { Logo } from './components/Logo';
import { ProveedorAvisos } from './components/ui';
import estilos from './pages/Portada.module.css';

// Rutas de la aplicación. Se usan <Routes> (no el router de datos): la aplicación no necesita loaders ni actions.
// Cada pantalla se descarga solo cuando se visita (React.lazy): quien entra a registrarse no baja el panel,
// y quien entra al panel no baja los formularios de acceso.
const Registro = lazy(() => import('./pages/Registro'));
const Ingresar = lazy(() => import('./pages/Ingresar'));
const Activar = lazy(() => import('./pages/Activar'));
const Inicio = lazy(() => import('./pages/Inicio'));
const Usuarios = lazy(() => import('./pages/Usuarios'));
const DisenoApp = lazy(() => import('./components/app/DisenoApp').then((m) => ({ default: m.DisenoApp })));
// Funcionalidad 002 (T038): esqueleto de rutas. Cada historia reemplaza PaginaPendiente por su pantalla.
const PaginaPendiente = lazy(() => import('./pages/PaginaPendiente'));
const RegistroCliente = lazy(() => import('./pages/publico/RegistroCliente'));
const IngresarBarberia = lazy(() => import('./pages/publico/IngresarBarberia'));
const ReservarProtegida = lazy(() =>
  import('./pages/publico/Reservar').then((m) => ({ default: m.ReservarProtegida })),
);

/** Rutas del panel de 002 y los roles que las ven (solo navegación: el backend exige los permisos). */
const RUTAS_PANEL_002: { ruta: string; titulo: string; roles: ('PROPIETARIO' | 'BARBERO')[] }[] = [
  { ruta: 'barberia', titulo: 'Barbería', roles: ['PROPIETARIO'] },
  { ruta: 'servicios', titulo: 'Servicios', roles: ['PROPIETARIO'] },
  { ruta: 'barberos', titulo: 'Barberos', roles: ['PROPIETARIO'] },
  { ruta: 'disponibilidad', titulo: 'Disponibilidad', roles: ['PROPIETARIO', 'BARBERO'] },
  { ruta: 'agenda', titulo: 'Agenda', roles: ['PROPIETARIO', 'BARBERO'] },
  { ruta: 'clientes', titulo: 'Clientes', roles: ['PROPIETARIO'] },
];

/** Rutas públicas por el enlace de la barbería (ADR-021) y del cliente. */
const RUTAS_ENLACE_002: { ruta: string; titulo: string }[] = [
  { ruta: '/b/:slug', titulo: 'Catálogo de la barbería' },
];

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
      <Suspense fallback={<PantallaCarga />}>
        <Routes>
          <Route path="/" element={<Portada />} />
          <Route path="/registro" element={<Registro />} />
          <Route path="/ingresar" element={<Ingresar />} />
          <Route path="/activar" element={<Activar />} />
          {RUTAS_ENLACE_002.map(({ ruta, titulo }) => (
            <Route key={ruta} path={ruta} element={<PaginaPendiente titulo={titulo} />} />
          ))}
          <Route path="/b/:slug/registro" element={<RegistroCliente />} />
          <Route path="/b/:slug/ingresar" element={<IngresarBarberia />} />
          <Route path="/b/:slug/reservar" element={<ReservarProtegida />} />
          <Route
            path="/mis-citas"
            element={
              <RutaProtegida roles={['CLIENTE']}>
                <PaginaPendiente titulo="Mis citas" />
              </RutaProtegida>
            }
          />
          <Route
            path="/app"
            element={
              <RutaProtegida roles={['PROPIETARIO', 'BARBERO']}>
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
            {RUTAS_PANEL_002.map(({ ruta, titulo, roles }) => (
              <Route
                key={ruta}
                path={ruta}
                element={
                  <RutaProtegida roles={roles}>
                    <PaginaPendiente titulo={titulo} />
                  </RutaProtegida>
                }
              />
            ))}
          </Route>
          <Route path="*" element={<NoEncontrada />} />
        </Routes>
      </Suspense>
    </ProveedorAvisos>
  );
}
