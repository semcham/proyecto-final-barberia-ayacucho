import { type ComponentType, lazy, Suspense } from 'react';
import { Link, Route, Routes } from 'react-router-dom';
import { PantallaCarga } from './auth/PantallaCarga';
import { RutaProtegida } from './auth/RutaProtegida';
import { Icono } from './components/Icono';
import { Logo } from './components/Logo';
import { clasesBoton, ProveedorAvisos } from './components/ui';
import type { PantallaCliente } from './pages/cliente/ClienteSinSesion';
import estilos from './pages/NoEncontrada.module.css';

// Rutas de la aplicación. Se usan <Routes> (no el router de datos): la aplicación no necesita loaders ni actions.
// Cada pantalla se descarga solo cuando se visita (React.lazy): quien entra a registrarse no baja el panel,
// y quien entra al panel no baja los formularios de acceso.
// Portada para dueños de barbería (rediseño de 2026-11), en su propio archivo.
const Portada = lazy(() => import('./pages/Portada'));
const Registro = lazy(() => import('./pages/Registro'));
const Ingresar = lazy(() => import('./pages/Ingresar'));
const Activar = lazy(() => import('./pages/Activar'));
const Inicio = lazy(() => import('./pages/Inicio'));
const Usuarios = lazy(() => import('./pages/Usuarios'));
const DisenoApp = lazy(() => import('./components/app/DisenoApp').then((m) => ({ default: m.DisenoApp })));
// Funcionalidad 002 (T038): esqueleto de rutas. Cada historia reemplaza PaginaPendiente por su pantalla.
const PaginaPendiente = lazy(() => import('./pages/PaginaPendiente'));
const CatalogoPublico = lazy(() => import('./pages/publico/CatalogoPublico'));
const Barberia = lazy(() => import('./pages/panel/Barberia'));
const Servicios = lazy(() => import('./pages/panel/Servicios'));
const Barberos = lazy(() => import('./pages/panel/Barberos'));
const Disponibilidad = lazy(() => import('./pages/panel/Disponibilidad'));
const Agenda = lazy(() => import('./pages/panel/Agenda'));
const MisCitas = lazy(() => import('./pages/cliente/MisCitas'));
// /mis-citas sin sesión: cómo ingresar desde la barbería (el cliente no ingresa por /ingresar, ADR-020).
const ClienteSinSesion = lazy(() => import('./pages/cliente/ClienteSinSesion'));
const CanalAviso = lazy(() => import('./pages/cliente/CanalAviso'));
const Clientes = lazy(() => import('./pages/panel/Clientes'));
const RegistroCliente = lazy(() => import('./pages/publico/RegistroCliente'));
const IngresarBarberia = lazy(() => import('./pages/publico/IngresarBarberia'));
// Funcionalidad 010 (T012): los textos legales publicados, sin sesión.
const Terminos = lazy(() => import('./pages/publico/DocumentoLegal').then((m) => ({ default: m.Terminos })));
const Privacidad = lazy(() =>
  import('./pages/publico/DocumentoLegal').then((m) => ({ default: m.Privacidad })),
);
// Funcionalidad 004 (T097): la página pública del enlace de acción del recordatorio (/e#<token>).
const Enlace = lazy(() => import('./pages/publico/Enlace'));
// Funcionalidad 010 (T062): verificar el correo con el enlace del correo (/verificar#<token>).
const Verificar = lazy(() => import('./pages/publico/Verificar'));
// Funcionalidad 010 (T079): recuperar la contraseña (/recuperar) y elegir la nueva (/restablecer#<token>).
const Recuperar = lazy(() => import('./pages/publico/Recuperar'));
const Restablecer = lazy(() => import('./pages/publico/Restablecer'));
// Funcionalidad 003 (T051).
const Suscripcion = lazy(() => import('./pages/panel/Suscripcion'));
// Funcionalidad 008 (T018): configuración del adelanto de reserva con QR.
const Adelanto = lazy(() => import('./pages/panel/Adelanto'));
// Funcionalidad 008 (T045): la bandeja de pagos de adelanto por revisar.
const AdelantosPorRevisar = lazy(() => import('./pages/panel/AdelantosPorRevisar'));
// 005 (T023): reportes del propietario.
const Reportes = lazy(() => import('./pages/panel/Reportes'));
// 005 (T045): asistente del cliente.
const Asistente = lazy(() => import('./pages/cliente/Asistente'));
// Funcionalidad 008 (T033): el cliente paga el adelanto de su cita.
const PagarAdelanto = lazy(() => import('./pages/cliente/PagarAdelanto'));
// Funcionalidad 007 (T015): solicitudes sobre datos personales del cliente, del barbero y bandeja del propietario.
const MisDatos = lazy(() => import('./pages/cliente/MisDatos'));
const MisDatosBarbero = lazy(() => import('./pages/panel/MisDatos'));
const SolicitudesDatos = lazy(() => import('./pages/panel/SolicitudesDatos'));
const ReservarProtegida = lazy(() =>
  import('./pages/publico/Reservar').then((m) => ({ default: m.ReservarProtegida })),
);
// Administrador de la plataforma (003, T071): su propia sesión, que solo se descarga al visitar /plataforma.
const RaizPlataforma = lazy(() => import('./auth/plataforma').then((m) => ({ default: m.RaizPlataforma })));
const RutaPlataforma = lazy(() => import('./auth/plataforma').then((m) => ({ default: m.RutaPlataforma })));
const IngresarPlataforma = lazy(() => import('./pages/plataforma/Ingresar'));
const DisenoPlataforma = lazy(() =>
  import('./components/plataforma/DisenoPlataforma').then((m) => ({ default: m.DisenoPlataforma })),
);
const InicioPlataforma = lazy(() => import('./pages/plataforma/Inicio'));
const ComprobantesPlataforma = lazy(() => import('./pages/plataforma/Comprobantes'));
const PagosPorRevisarPlataforma = lazy(() => import('./pages/plataforma/PagosPorRevisar'));
const BarberiasPlataforma = lazy(() => import('./pages/plataforma/Barberias'));
// Funcionalidad 007 (T038): indicadores agregados de la plataforma.
const IndicadoresPlataforma = lazy(() => import('./pages/plataforma/Indicadores'));

/**
 * Rutas del panel de 002 y los roles que las ven (solo navegación: el backend exige los permisos). Las que
 * aún no tienen `pantalla` muestran PaginaPendiente hasta que llegue su historia.
 */
const RUTAS_PANEL_002: {
  ruta: string;
  titulo: string;
  roles: ('PROPIETARIO' | 'BARBERO')[];
  pantalla?: ComponentType;
}[] = [
  { ruta: 'barberia', titulo: 'Barbería', roles: ['PROPIETARIO'], pantalla: Barberia },
  { ruta: 'servicios', titulo: 'Servicios', roles: ['PROPIETARIO'], pantalla: Servicios },
  { ruta: 'barberos', titulo: 'Barberos', roles: ['PROPIETARIO'], pantalla: Barberos },
  {
    ruta: 'disponibilidad',
    titulo: 'Disponibilidad',
    roles: ['PROPIETARIO', 'BARBERO'],
    pantalla: Disponibilidad,
  },
  { ruta: 'agenda', titulo: 'Agenda', roles: ['PROPIETARIO', 'BARBERO'], pantalla: Agenda },
  { ruta: 'clientes', titulo: 'Clientes', roles: ['PROPIETARIO'], pantalla: Clientes },
];

/** Una pantalla del cliente sin sesión: cómo ingresar desde su barbería y volver a `desde` (ADR-020; 010, US4). */
const sinSesionDe = (pantalla: PantallaCliente) => (desde: string) => (
  <ClienteSinSesion pantalla={pantalla} desde={desde} />
);

function NoEncontrada() {
  return (
    <main className={estilos.portada}>
      <Logo />
      <div className={estilos.hero}>
        <p className="antetitulo">Error 404</p>
        <h1>Página no encontrada</h1>
        <p className={estilos.bajada}>La dirección que abriste no existe o cambió.</p>
        <div className={estilos.acciones}>
          <Link to="/" className={clasesBoton({ variante: 'secundario' })}>
            <Icono nombre="inicio" tamano={18} />
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
          <Route path="/terminos" element={<Terminos />} />
          <Route path="/privacidad" element={<Privacidad />} />
          {/* Vía pública por el enlace de la barbería (ADR-021) y cuenta de cliente. */}
          <Route path="/b/:slug" element={<CatalogoPublico />} />
          <Route path="/b/:slug/registro" element={<RegistroCliente />} />
          <Route path="/b/:slug/ingresar" element={<IngresarBarberia />} />
          <Route path="/b/:slug/reservar" element={<ReservarProtegida />} />
          <Route path="/e" element={<Enlace />} />
          <Route path="/verificar" element={<Verificar />} />
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/restablecer" element={<Restablecer />} />
          <Route
            path="/mis-citas"
            element={
              <RutaProtegida roles={['CLIENTE']} sinSesion={sinSesionDe('mis-citas')}>
                <MisCitas />
              </RutaProtegida>
            }
          />
          {/* 010 (T024, FR-028): las demás pantallas del cliente, igual que /mis-citas, nunca llevan a /ingresar. */}
          <Route
            path="/mis-citas/:citaId/adelanto"
            element={
              <RutaProtegida roles={['CLIENTE']} sinSesion={sinSesionDe('adelanto')}>
                <PagarAdelanto />
              </RutaProtegida>
            }
          />
          <Route
            path="/asistente"
            element={
              <RutaProtegida roles={['CLIENTE']} sinSesion={sinSesionDe('asistente')}>
                <Asistente />
              </RutaProtegida>
            }
          />
          <Route
            path="/mis-avisos"
            element={
              <RutaProtegida roles={['CLIENTE']} sinSesion={sinSesionDe('mis-avisos')}>
                <CanalAviso />
              </RutaProtegida>
            }
          />
          <Route
            path="/mis-datos"
            element={
              <RutaProtegida roles={['CLIENTE']} sinSesion={sinSesionDe('mis-datos')}>
                <MisDatos />
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
            <Route
              path="suscripcion"
              element={
                <RutaProtegida roles={['PROPIETARIO']}>
                  <Suscripcion />
                </RutaProtegida>
              }
            />
            <Route
              path="adelanto"
              element={
                <RutaProtegida roles={['PROPIETARIO']}>
                  <Adelanto />
                </RutaProtegida>
              }
            />
            <Route
              path="adelantos"
              element={
                <RutaProtegida roles={['PROPIETARIO']}>
                  <AdelantosPorRevisar />
                </RutaProtegida>
              }
            />
            <Route
              path="reportes"
              element={
                <RutaProtegida roles={['PROPIETARIO']}>
                  <Reportes />
                </RutaProtegida>
              }
            />
            <Route
              path="mis-datos"
              element={
                <RutaProtegida roles={['BARBERO']}>
                  <MisDatosBarbero />
                </RutaProtegida>
              }
            />
            <Route
              path="solicitudes-datos"
              element={
                <RutaProtegida roles={['PROPIETARIO']}>
                  <SolicitudesDatos />
                </RutaProtegida>
              }
            />
            {RUTAS_PANEL_002.map(({ ruta, titulo, roles, pantalla: Pantalla }) => (
              <Route
                key={ruta}
                path={ruta}
                element={
                  <RutaProtegida roles={roles}>
                    {Pantalla ? <Pantalla /> : <PaginaPendiente titulo={titulo} />}
                  </RutaProtegida>
                }
              />
            ))}
          </Route>
          <Route path="/plataforma" element={<RaizPlataforma />}>
            <Route path="ingresar" element={<IngresarPlataforma />} />
            <Route
              element={
                <RutaPlataforma>
                  <DisenoPlataforma />
                </RutaPlataforma>
              }
            >
              <Route index element={<InicioPlataforma />} />
              <Route path="comprobantes" element={<ComprobantesPlataforma />} />
              <Route path="pagos-por-revisar" element={<PagosPorRevisarPlataforma />} />
              <Route path="barberias" element={<BarberiasPlataforma />} />
              <Route path="indicadores" element={<IndicadoresPlataforma />} />
            </Route>
          </Route>
          <Route path="*" element={<NoEncontrada />} />
        </Routes>
      </Suspense>
    </ProveedorAvisos>
  );
}
