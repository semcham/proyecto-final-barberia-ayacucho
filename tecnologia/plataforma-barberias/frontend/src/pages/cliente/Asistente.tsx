import { Link } from 'react-router-dom';
import { useSesion } from '../../auth/SesionProvider';
import { Conversacion } from '../../components/app/Conversacion';
import { Logo } from '../../components/Logo';
import { clasesBoton } from '../../components/ui';
import panel from '../panel/Panel.module.css';
import estilos from './Asistente.module.css';

// T045 de 005 · Asistente del cliente (/asistente; US1, FR-007, FR-008, FR-012, FR-013 y FR-018). Preguntas en
// lenguaje natural sobre los servicios, los barberos y los horarios libres de SU barbería. Las respuestas las compone
// el servidor con los datos de la barbería; aquí solo se muestran. La conversación (compartida con la pestaña
// "Preguntar" de los reportes del propietario, US3) vive solo en memoria: al recargar empieza de nuevo y se envían
// como mucho las últimas 6 intervenciones. El asistente nunca reserva: cada hora libre lleva a Reservar con todo
// elegido.

export default function Asistente() {
  const { usuario } = useSesion();
  const barberia = usuario?.barberia;

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <Logo />
        <Link to="/mis-citas" className={clasesBoton({ variante: 'fantasma', tamano: 'sm' })}>
          Mis citas
        </Link>
      </header>
      <div className={estilos.titulo}>
        <p className="antetitulo">{barberia?.nombre}</p>
        <h1>Asistente</h1>
        <p className={panel.aviso}>
          Pregúntame por los servicios, los barberos o los horarios libres de tu barbería. No reservo ni
          cambio citas: te llevo a Reservar con todo elegido.
        </p>
      </div>

      <Conversacion
        ejemplo="Por ejemplo: ¿hay horario mañana para un corte?"
        alternativa={{
          tipo: 'RESERVAR',
          contenido: barberia && (
            <Link
              to={`/b/${barberia.slug}`}
              className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}
            >
              Ir a reservar
            </Link>
          ),
        }}
      />
    </main>
  );
}
