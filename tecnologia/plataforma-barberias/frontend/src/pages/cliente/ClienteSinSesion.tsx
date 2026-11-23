import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icono } from '../../components/Icono';
import { Logo } from '../../components/Logo';
import { clasesBoton } from '../../components/ui';
import { ultimaBarberia } from '../../ultima-barberia';
import panel from '../panel/Panel.module.css';
import estilos from './MisCitas.module.css';

/** Pantallas del cliente que, sin sesión, muestran esta explicación en vez de llevar a /ingresar (010, FR-028). */
export type PantallaCliente = 'mis-citas' | 'asistente' | 'mis-avisos' | 'mis-datos' | 'adelanto';

interface Textos {
  /** El mismo título que la pantalla con sesión. */
  titulo: string;
  /** Con una barbería recordada: "{motivo}, ingresa con tu cuenta en la página de …". */
  motivo: string;
  /** Con una barbería recordada: qué hacer si la que corresponde es otra. */
  otraBarberia: string;
  /** Sin barbería recordada: la frase que abre los pasos. */
  dondeSeUsa: string;
  /** Sin barbería recordada: el último paso, ya con la sesión iniciada. */
  ultimoPaso: string;
}

const TEXTOS: Record<PantallaCliente, Textos> = {
  'mis-citas': {
    titulo: 'Mis citas',
    motivo: 'Para ver tus citas',
    otraBarberia: '¿Tus citas son de otra barbería? Abre el enlace de esa barbería e ingresa desde allí.',
    dondeSeUsa: 'Tus citas se ven desde la página de tu barbería. Para llegar:',
    ultimoPaso: 'Ya dentro, pulsa «Mis citas».',
  },
  asistente: {
    titulo: 'Asistente',
    motivo: 'Para preguntar al asistente',
    otraBarberia:
      '¿Quieres preguntar sobre otra barbería? Abre el enlace de esa barbería e ingresa desde allí.',
    dondeSeUsa: 'El asistente se usa desde la página de tu barbería. Para llegar:',
    ultimoPaso: 'Ya dentro, pulsa «Mis citas» y luego «Preguntar al asistente».',
  },
  'mis-avisos': {
    titulo: 'Cómo recibo mis avisos',
    motivo: 'Para ver y elegir cómo recibes tus avisos',
    otraBarberia: '¿Tus avisos son de otra barbería? Abre el enlace de esa barbería e ingresa desde allí.',
    dondeSeUsa: 'Tus avisos se eligen desde la página de tu barbería. Para llegar:',
    ultimoPaso: 'Ya dentro, pulsa «Mis citas» y luego «Cómo recibo mis avisos».',
  },
  'mis-datos': {
    titulo: 'Mis datos',
    motivo: 'Para ver y registrar tus solicitudes sobre tus datos personales',
    otraBarberia:
      '¿Tus datos están en otra barbería? Cada barbería atiende las solicitudes de sus clientes: abre el enlace de esa barbería e ingresa desde allí.',
    dondeSeUsa: 'Tus solicitudes sobre tus datos se hacen desde la página de tu barbería. Para llegar:',
    ultimoPaso: 'Ya dentro, pulsa «Mis citas» y luego «Mis datos».',
  },
  adelanto: {
    titulo: 'Pagar adelanto',
    motivo: 'Para pagar el adelanto de tu cita',
    otraBarberia: '¿Tu cita es de otra barbería? Abre el enlace de esa barbería e ingresa desde allí.',
    dondeSeUsa: 'El adelanto de tu cita se paga desde la página de tu barbería. Para llegar:',
    ultimoPaso: 'Ya dentro, pulsa «Mis citas» y, en tu cita, «Pagar adelanto».',
  },
};

/**
 * Una pantalla del cliente (por ejemplo, /mis-citas) abierta sin sesión. La cuenta del cliente se usa siempre desde
 * el enlace de su barbería (ADR-020), así que no lleva a /ingresar (el del personal):
 * - si este navegador abrió hace poco la página de una barbería, ofrece "Ingresar" en ella y vuelve aquí después;
 * - si no, explica cómo llegar a la página de su barbería.
 * Solo navegación: el ingreso, la unión a la barbería y los permisos siguen en el servidor.
 */
export default function ClienteSinSesion({ pantalla, desde }: { pantalla: PantallaCliente; desde: string }) {
  // Se lee una vez al abrir la pantalla; si el almacenamiento no está disponible, devuelve null.
  const [barberia] = useState(() => ultimaBarberia.leer());
  const textos = TEXTOS[pantalla];

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo />
      </header>
      <div className={estilos.titulo}>
        <h1>{textos.titulo}</h1>
      </div>
      {barberia ? (
        <>
          <p>
            {textos.motivo}, ingresa con tu cuenta en la página de <strong>{barberia.nombre}</strong>.
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
          <p className={panel.aviso}>{textos.otraBarberia}</p>
        </>
      ) : (
        <>
          <p>{textos.dondeSeUsa}</p>
          <ol>
            <li>
              Abre el enlace de tu barbería. Te lo comparte la barbería, por ejemplo por WhatsApp o en su
              local.
            </li>
            <li>En esa página, pulsa «Ingresar», arriba, y usa el correo y la contraseña de tu cuenta.</li>
            <li>{textos.ultimoPaso}</li>
          </ol>
          <p className={panel.aviso}>
            ¿Trabajas en una barbería? <Link to="/ingresar">Ingresa al panel</Link>.
          </p>
        </>
      )}
    </main>
  );
}
