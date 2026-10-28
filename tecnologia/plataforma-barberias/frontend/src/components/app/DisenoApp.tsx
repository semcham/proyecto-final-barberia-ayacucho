import { Suspense } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { type RolSesion, useSesion } from '../../auth/SesionProvider';
import { Icono, type NombreIcono } from '../Icono';
import { Logo } from '../Logo';
import { ConmutadorTema } from '../ui';
import { AvisoSuscripcion } from './AvisoSuscripcion';
import estilos from './DisenoApp.module.css';
import { MenuUsuario } from './MenuUsuario';

interface Destino {
  a: string;
  etiqueta: string;
  icono: NombreIcono;
  /** Roles que ven el enlace; sin valor, todos. Solo una ayuda de navegación: el backend exige el rol. */
  roles?: RolSesion[];
}

const DESTINOS: Destino[] = [
  { a: '/app', etiqueta: 'Inicio', icono: 'inicio' },
  // Funcionalidad 002 (T038).
  { a: '/app/agenda', etiqueta: 'Agenda', icono: 'calendario', roles: ['PROPIETARIO', 'BARBERO'] },
  { a: '/app/disponibilidad', etiqueta: 'Disponibilidad', icono: 'reloj', roles: ['PROPIETARIO', 'BARBERO'] },
  { a: '/app/servicios', etiqueta: 'Servicios', icono: 'tijeras', roles: ['PROPIETARIO'] },
  { a: '/app/barberos', etiqueta: 'Barberos', icono: 'usuario', roles: ['PROPIETARIO'] },
  { a: '/app/clientes', etiqueta: 'Clientes', icono: 'celular', roles: ['PROPIETARIO'] },
  { a: '/app/barberia', etiqueta: 'Barbería', icono: 'tienda', roles: ['PROPIETARIO'] },
  { a: '/app/usuarios', etiqueta: 'Usuarios', icono: 'usuarios', roles: ['PROPIETARIO'] },
  // Funcionalidad 003 (T051).
  { a: '/app/suscripcion', etiqueta: 'Suscripción', icono: 'dinero', roles: ['PROPIETARIO'] },
];

const PROXIMAMENTE: { etiqueta: string; icono: NombreIcono }[] = [{ etiqueta: 'Ingresos', icono: 'dinero' }];

function fechaDeHoy(): string {
  const texto = new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long' }).format(
    new Date(),
  );
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Estructura de la aplicación con sesión. Escritorio (64rem o más): barra lateral con marca, barbería y
 * navegación. Celular y tableta: cabecera compacta y la misma navegación fija abajo. Una sola <nav>
 * "Principal" que cambia de lugar con CSS, para no duplicar enlaces a lectores de pantalla.
 */
export function DisenoApp() {
  const { usuario } = useSesion();
  const destinos = DESTINOS.filter((d) => !d.roles || (usuario !== null && d.roles.includes(usuario.rol)));
  const barberia = usuario?.barberia.nombre;

  return (
    <div className={estilos.app} data-diseno-app="">
      <a href="#contenido" className={estilos.saltar}>
        Saltar al contenido
      </a>

      <aside className={estilos.lateral}>
        <div className={estilos.marca}>
          <Logo destino="/app" />
        </div>

        <div className={estilos.barberia}>
          <span className={estilos.barberiaEtiqueta}>Tu barbería</span>
          <strong>{barberia}</strong>
        </div>

        <nav aria-label="Principal" className={estilos.navegacion}>
          <ul>
            {destinos.map((destino) => (
              <li key={destino.a}>
                <NavLink
                  to={destino.a}
                  end={destino.a === '/app'}
                  className={({ isActive }) =>
                    isActive ? `${estilos.enlace} ${estilos.activo}` : estilos.enlace
                  }
                >
                  <Icono nombre={destino.icono} />
                  <span>{destino.etiqueta}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className={estilos.proximamente}>
          <p className={estilos.proximamenteTitulo}>Próximamente</p>
          <ul>
            {PROXIMAMENTE.map((item) => (
              <li key={item.etiqueta}>
                <Icono nombre={item.icono} tamano={18} />
                {item.etiqueta}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <div className={estilos.area}>
        <header className={estilos.cabecera}>
          <div className={estilos.cabeceraMovil}>
            <Logo compacto destino="/app" />
            <strong>{barberia}</strong>
          </div>
          <p className={estilos.fecha}>{fechaDeHoy()}</p>
          <div className={estilos.herramientas}>
            <ConmutadorTema />
            <MenuUsuario />
          </div>
        </header>

        <main id="contenido" tabIndex={-1} className={estilos.contenido}>
          <AvisoSuscripcion />
          <Suspense
            fallback={
              <div className={estilos.cargandoPagina} aria-busy="true">
                <span className="girador" aria-hidden="true" />
                <span>Cargando…</span>
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
