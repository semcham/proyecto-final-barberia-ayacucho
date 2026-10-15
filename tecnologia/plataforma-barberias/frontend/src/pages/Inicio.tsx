import { useLocation } from 'react-router-dom';
import type { EstadoBienvenida } from './Registro';

const DIA_MS = 24 * 60 * 60 * 1000;

function diasRestantes(venceEn: string, ahora = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(venceEn).getTime() - ahora) / DIA_MS));
}

/**
 * Pantalla de bienvenida tras el registro (T072): nombre de la barbería y días restantes de prueba.
 * Por ahora recibe los datos del registro; US2 la conectará a la sesión (GET /auth/yo).
 */
export default function Inicio() {
  const estado = useLocation().state as EstadoBienvenida | null;

  if (!estado) {
    return (
      <main className="contenedor">
        <h1>Bienvenido</h1>
        <p>Tu barbería está lista.</p>
      </main>
    );
  }

  const dias = diasRestantes(estado.suscripcion.venceEn);
  return (
    <main className="contenedor">
      <h1>{estado.barberia.nombre}</h1>
      <p>Tu prueba gratuita está activa: te {dias === 1 ? 'queda 1 día' : `quedan ${dias} días`}.</p>
    </main>
  );
}
