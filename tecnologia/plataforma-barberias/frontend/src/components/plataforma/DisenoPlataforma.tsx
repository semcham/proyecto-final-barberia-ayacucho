import { Suspense, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { usePlataforma } from '../../auth/plataforma';
import estilos from '../app/DisenoApp.module.css';
import { Icono, type NombreIcono } from '../Icono';
import { Logo } from '../Logo';
import { Boton, ConmutadorTema } from '../ui';

// T071 · Diseño de /plataforma: la misma estructura del panel de las barberías (barra lateral en escritorio y
// navegación abajo en el celular), con su propio menú y su propia salida.

const DESTINOS: { a: string; etiqueta: string; icono: NombreIcono }[] = [
  { a: '/plataforma', etiqueta: 'Inicio', icono: 'inicio' },
  // US3 (T084).
  { a: '/plataforma/comprobantes', etiqueta: 'Comprobantes', icono: 'dinero' },
  // US4 (T091).
  { a: '/plataforma/pagos-por-revisar', etiqueta: 'Pagos por revisar', icono: 'alerta' },
  // US5 (T099).
  { a: '/plataforma/barberias', etiqueta: 'Barberías', icono: 'tienda' },
];

export function DisenoPlataforma() {
  const { salir } = usePlataforma();
  const navegar = useNavigate();
  const [saliendo, setSaliendo] = useState(false);

  const cerrar = async () => {
    setSaliendo(true);
    try {
      await salir();
    } finally {
      navegar('/plataforma/ingresar', { replace: true });
    }
  };

  return (
    <div className={estilos.app} data-diseno-plataforma="">
      <a href="#contenido" className={estilos.saltar}>
        Saltar al contenido
      </a>

      <aside className={estilos.lateral}>
        <div className={estilos.marca}>
          <Logo destino="/plataforma" />
        </div>
        <div className={estilos.barberia}>
          <span className={estilos.barberiaEtiqueta}>Administración</span>
          <strong>Plataforma</strong>
        </div>
        <nav aria-label="Plataforma" className={estilos.navegacion}>
          <ul>
            {DESTINOS.map((destino) => (
              <li key={destino.a}>
                <NavLink
                  to={destino.a}
                  end
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
      </aside>

      <div className={estilos.area}>
        <header className={estilos.cabecera}>
          <div className={estilos.cabeceraMovil}>
            <Logo compacto destino="/plataforma" />
            <strong>Plataforma</strong>
          </div>
          <div className={estilos.herramientas}>
            <ConmutadorTema />
            <Boton
              type="button"
              variante="secundario"
              tamano="sm"
              onClick={cerrar}
              cargando={saliendo}
              textoCargando="Saliendo…"
            >
              <Icono nombre="salir" tamano={16} />
              Salir
            </Boton>
          </div>
        </header>

        <main id="contenido" tabIndex={-1} className={estilos.contenido}>
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
