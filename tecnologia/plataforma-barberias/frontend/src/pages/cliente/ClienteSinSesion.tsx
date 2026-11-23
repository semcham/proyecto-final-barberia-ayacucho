import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icono } from '../../components/Icono';
import { Logo } from '../../components/Logo';
import { clasesBoton } from '../../components/ui';
import { ultimaBarberia } from '../../ultima-barberia';
import panel from '../panel/Panel.module.css';
import estilos from './MisCitas.module.css';

/**
 * Una pantalla del cliente (por ejemplo, /mis-citas) abierta sin sesión. La cuenta del cliente se usa siempre desde
 * el enlace de su barbería (ADR-020), así que no lleva a /ingresar (el del personal):
 * - si este navegador abrió hace poco la página de una barbería, ofrece "Ingresar" en ella y vuelve aquí después;
 * - si no, explica cómo llegar a la página de su barbería.
 * Solo navegación: el ingreso, la unión a la barbería y los permisos siguen en el servidor.
 */
export default function ClienteSinSesion({ titulo, desde }: { titulo: string; desde: string }) {
  // Se lee una vez al abrir la pantalla; si el almacenamiento no está disponible, devuelve null.
  const [barberia] = useState(() => ultimaBarberia.leer());

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo />
      </header>
      <div className={estilos.titulo}>
        <h1>{titulo}</h1>
      </div>
      {barberia ? (
        <>
          <p>
            Para ver tus citas, ingresa con tu cuenta en la página de <strong>{barberia.nombre}</strong>.
          </p>
          <div className={panel.acciones}>
            <Link to={`/b/${barberia.slug}/ingresar`} state={{ desde }} className={clasesBoton()}>
              <Icono nombre="usuario" tamano={18} />
              Ingresar
            </Link>
            <Link to={`/b/${barberia.slug}`} className={clasesBoton({ variante: 'secundario' })}>
              Ver la página de la barbería
            </Link>
          </div>
          <p className={panel.aviso}>
            ¿Tus citas son de otra barbería? Abre el enlace de esa barbería e ingresa desde allí.
          </p>
        </>
      ) : (
        <>
          <p>Tus citas se ven desde la página de tu barbería. Para llegar:</p>
          <ol>
            <li>
              Abre el enlace de tu barbería. Te lo comparte la barbería, por ejemplo por WhatsApp o en su
              local.
            </li>
            <li>En esa página, pulsa «Ingresar», arriba, y usa el correo y la contraseña de tu cuenta.</li>
            <li>Ya dentro, pulsa «Mis citas».</li>
          </ol>
          <p className={panel.aviso}>
            ¿Trabajas en una barbería? <Link to="/ingresar">Ingresa al panel</Link>.
          </p>
        </>
      )}
    </main>
  );
}
