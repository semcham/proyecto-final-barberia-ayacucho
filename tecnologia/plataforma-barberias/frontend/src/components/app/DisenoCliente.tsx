import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useSesion } from '../../auth/SesionProvider';
import { Icono, type NombreIcono } from '../Icono';
import { iniciales } from '../iniciales';
import { Logo } from '../Logo';
import {
  clasesBoton,
  ConmutadorTema,
  Menu,
  MenuContenido,
  MenuDisparador,
  MenuEtiqueta,
  MenuItem,
  MenuSeparador,
} from '../ui';
import estilos from './DisenoCliente.module.css';

interface Pestana {
  a: string;
  texto: string;
  icono: NombreIcono;
  /** Cuándo la pestaña está activa (las pantallas de "Mi cuenta" y el pago del adelanto cuelgan de otras). */
  activa: (ruta: string) => boolean;
}

/**
 * Marco del panel del cliente con sesión (rediseño del 2026-11-24): encabezado azul noche con su barbería y su cuenta,
 * y la navegación de cuatro pestañas (Reservar, Mis citas, Asistente y Mi cuenta). En el celular la navegación es una
 * barra fija abajo; en escritorio, pestañas bajo el encabezado. Es UN solo `<nav>`: cambia de lugar con CSS.
 *
 * Solo navegación: cada pantalla sigue exigiendo su sesión (RutaProtegida) y el servidor decide los permisos.
 */
export function DisenoCliente({ children }: { children: ReactNode }) {
  const { usuario } = useSesion();
  const { pathname } = useLocation();
  const barberia = usuario?.barberia;

  const pestanas: Pestana[] = [
    {
      a: barberia ? `/b/${barberia.slug}/reservar` : '/mis-citas',
      texto: 'Reservar',
      icono: 'calendarioCheck',
      activa: (r) => /^\/b\/[^/]+\/reservar$/.test(r),
    },
    {
      a: '/mis-citas',
      texto: 'Mis citas',
      icono: 'calendario',
      activa: (r) => r === '/mis-citas' || r.startsWith('/mis-citas/'),
    },
    { a: '/asistente', texto: 'Asistente', icono: 'conversacion', activa: (r) => r === '/asistente' },
    {
      a: '/mi-cuenta',
      texto: 'Mi cuenta',
      icono: 'usuario',
      activa: (r) => ['/mi-cuenta', '/mis-datos', '/mis-avisos'].includes(r),
    },
  ];

  return (
    <div className={estilos.marco}>
      <a href="#contenido-panel" className={estilos.saltar}>
        Ir al contenido
      </a>
      <header className={estilos.cabecera}>
        <div className={estilos.cabeceraInterior}>
          <Logo compacto destino={barberia ? `/b/${barberia.slug}` : '/'} />
          <div className={estilos.barberia}>
            <span className={estilos.barberiaEtiqueta}>Tu barbería</span>
            {barberia && (
              <Link to={`/b/${barberia.slug}`} className={estilos.barberiaNombre}>
                {barberia.nombre}
              </Link>
            )}
          </div>
          <div className={estilos.cabeceraAcciones}>
            <span className={estilos.tema}>
              <ConmutadorTema />
            </span>
            <MenuCuenta />
          </div>
        </div>
      </header>

      <nav aria-label="Panel del cliente" className={estilos.navegacion}>
        <ul className={estilos.pestanas}>
          {pestanas.map((p) => {
            const activa = p.activa(pathname);
            return (
              <li key={p.texto}>
                <Link
                  to={p.a}
                  className={estilos.pestana}
                  aria-current={activa ? 'page' : undefined}
                  data-activa={activa || undefined}
                >
                  <Icono nombre={p.icono} tamano={22} />
                  <span>{p.texto}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <main id="contenido-panel" className={estilos.contenido} tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}

/** La cuenta del cliente: su nombre y correo, "Mi cuenta" y "Cerrar sesión" (vuelve a la página de su barbería). */
function MenuCuenta() {
  const { usuario, cerrarSesion } = useSesion();
  const navegar = useNavigate();
  const slug = usuario?.barberia.slug;

  return (
    <Menu>
      <MenuDisparador
        className={clasesBoton({ variante: 'fantasma', tamano: 'sm', className: estilos.disparador })}
        aria-label={`Tu cuenta: ${usuario?.nombre ?? ''}`}
      >
        <span className={estilos.avatar} aria-hidden="true">
          {iniciales(usuario?.nombre ?? '')}
        </span>
        <span className={estilos.disparadorNombre}>{usuario?.nombre}</span>
        <Icono nombre="chevronAbajo" tamano={14} />
      </MenuDisparador>
      <MenuContenido>
        <MenuEtiqueta className={estilos.resumen}>
          <span className={estilos.resumenNombre}>{usuario?.nombre}</span>
          <span className={estilos.resumenCorreo}>{usuario?.correo}</span>
        </MenuEtiqueta>
        <MenuSeparador />
        <MenuItem icono="usuario" onSelect={() => navegar('/mi-cuenta')}>
          Mi cuenta
        </MenuItem>
        <MenuItem
          icono="salir"
          peligro
          onSelect={() =>
            void cerrarSesion().then(() => navegar(slug ? `/b/${slug}` : '/', { replace: true }))
          }
        >
          Cerrar sesión
        </MenuItem>
      </MenuContenido>
    </Menu>
  );
}
