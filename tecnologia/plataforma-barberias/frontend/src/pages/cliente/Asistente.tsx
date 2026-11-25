import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSesion } from '../../auth/SesionProvider';
import { AvisoVerificacion } from '../../components/app/AvisoVerificacion';
import { Conversacion } from '../../components/app/Conversacion';
import { clasesBoton } from '../../components/ui';
import { EncabezadoCliente } from './EncabezadoCliente';
import estilos from './Asistente.module.css';

// T045 de 005 · Asistente del cliente (/asistente; US1, FR-007, FR-008, FR-012, FR-013 y FR-018). Preguntas en
// lenguaje natural sobre los servicios, los barberos y los horarios libres de SU barbería. Las respuestas las compone
// el servidor con los datos de la barbería; aquí solo se muestran. La conversación (compartida con la pestaña
// "Preguntar" de los reportes del propietario, US3) vive solo en memoria: al recargar empieza de nuevo y se envían
// como mucho las últimas 6 intervenciones. El asistente nunca reserva: cada hora libre lleva a Reservar con todo
// elegido. Desde el rediseño del 2026-11-24 vive dentro del panel del cliente (DisenoCliente).

export default function Asistente() {
  const { usuario } = useSesion();
  const barberia = usuario?.barberia;
  // 010 (T063, research R06): sin el correo verificado no se pregunta; también ante el 403 de otra sesión.
  const [rechazado, setRechazado] = useState(false);
  const sinVerificar = usuario?.correoVerificado === false || rechazado;

  return (
    <div className={estilos.pagina}>
      <EncabezadoCliente
        titulo="Asistente"
        descripcion="Pregúntame por los servicios, los barberos o los horarios libres de tu barbería. No reservo ni cambio citas: te llevo a Reservar con todo elegido."
      />

      {sinVerificar ? (
        <AvisoVerificacion accion="usar el asistente" alVerificar={() => setRechazado(false)} />
      ) : (
        <Conversacion
          ejemplo="Por ejemplo: ¿hay horario mañana para un corte?"
          alCorreoNoVerificado={() => setRechazado(true)}
          alternativa={{
            tipo: 'RESERVAR',
            contenido: barberia && (
              <Link
                to={`/b/${barberia.slug}/reservar`}
                className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}
              >
                Ir a reservar
              </Link>
            ),
          }}
        />
      )}
    </div>
  );
}
