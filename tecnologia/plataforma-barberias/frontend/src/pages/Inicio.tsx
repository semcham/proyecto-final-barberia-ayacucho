import { useLocation } from 'react-router-dom';
import { useSesion } from '../auth/SesionProvider';
import type { EstadoBienvenida } from './Registro';

const DIA_MS = 24 * 60 * 60 * 1000;

function diasRestantes(venceEn: string, ahora = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(venceEn).getTime() - ahora) / DIA_MS));
}

/**
 * Pantalla principal de la barbería. Justo después del registro también muestra los días de prueba; la
 * consulta permanente del estado de la suscripción llegará con RF19 (fuera de esta funcionalidad).
 */
export default function Inicio() {
  const { usuario } = useSesion();
  const bienvenida = useLocation().state as EstadoBienvenida | null;
  const nombre = usuario?.barberia.nombre ?? bienvenida?.barberia.nombre ?? 'Tu barbería';
  const dias = bienvenida ? diasRestantes(bienvenida.suscripcion.venceEn) : null;

  return (
    <main className="contenedor">
      <h1>{nombre}</h1>
      {dias !== null ? (
        <p>Tu prueba gratuita está activa: te {dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}.</p>
      ) : (
        <p>Hola, {usuario?.nombre}.</p>
      )}
    </main>
  );
}
