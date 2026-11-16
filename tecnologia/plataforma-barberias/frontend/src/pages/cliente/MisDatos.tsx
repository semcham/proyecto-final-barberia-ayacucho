import { Link } from 'react-router-dom';
import { useSesion } from '../../auth/SesionProvider';
import { MisSolicitudes } from '../../components/datos-personales/MisSolicitudes';
import { Logo } from '../../components/Logo';
import { Boton, clasesBoton } from '../../components/ui';
import estilosCitas from './MisCitas.module.css';

/**
 * T015 de 007 · "Mis datos" del cliente (/mis-datos; US1, FR-001, FR-006). Solo con sesión de cliente, en la barbería
 * de su sesión; se llega desde Mis citas.
 */
export default function MisDatos() {
  const { usuario, cerrarSesion } = useSesion();
  return (
    <main className={estilosCitas.pagina}>
      <header className={estilosCitas.cabecera}>
        <Logo />
        <Boton
          type="button"
          variante="fantasma"
          tamano="sm"
          icono="salir"
          onClick={() => void cerrarSesion()}
        >
          Salir
        </Boton>
      </header>
      <div className={estilosCitas.titulo}>
        <p className="antetitulo">{usuario?.barberia?.nombre}</p>
        <h1>Mis datos</h1>
        <p>
          Pide acceso, corrección o eliminación de tus datos personales en esta barbería. La barbería la
          atiende y te responde aquí.
        </p>
      </div>
      <div>
        <Link to="/mis-citas" className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
          Volver a mis citas
        </Link>
      </div>
      <MisSolicitudes />
    </main>
  );
}
