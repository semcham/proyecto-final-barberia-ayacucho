import { NavLink, Outlet } from 'react-router-dom';
import { useSesion } from '../../auth/SesionProvider';
import { Icono, type NombreIcono } from '../Icono';
import { Logo } from '../Logo';
import { ConmutadorTema } from '../ui';
import estilos from './DisenoApp.module.css';
import { MenuUsuario } from './MenuUsuario';

interface Destino {
  a: string;
  etiqueta: string;
  icono: NombreIcono;
  /** Solo una ayuda de navegación: el backend exige el rol en cada operación. */
  soloPropietario?: boolean;
}

const DESTINOS: Destino[] = [
  { a: '/app', etiqueta: 'Inicio', icono: 'inicio' },
  { a: '/app/usuarios', etiqueta: 'Usuarios', icono: 'usuarios', soloPropietario: true },
];

const PROXIMAMENTE: { etiqueta: string; icono: NombreIcono }[] = [
  { etiqueta: 'Agenda y citas', icono: 'calendario' },
  { etiqueta: 'Ingresos', icono: 'dinero' },
];

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
  const destinos = DESTINOS.filter((d) => !d.soloPropietario || usuario?.rol === 'PROPIETARIO');
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
          <Outlet />
        </main>
      </div>
    </div>
  );
}
