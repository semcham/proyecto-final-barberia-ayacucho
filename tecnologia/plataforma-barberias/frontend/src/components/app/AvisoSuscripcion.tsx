import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { suscribirRestriccionSuscripcion } from '../../api/client';
import { apiSuscripcion, type Suscripcion } from '../../api/suscripcion';
import { useSesion } from '../../auth/SesionProvider';
import { Icono } from '../Icono';
import { clasesBoton } from '../ui/Boton';
import estilos from './AvisoSuscripcion.module.css';

const fecha = new Intl.DateTimeFormat('es-PE', { dateStyle: 'long', timeZone: 'America/Lima' });

/** Texto del aviso del propietario según el estado de la suscripción; null si no hay nada que avisar. */
function textoParaPropietario(s: Suscripcion): { texto: string; tono: 'aviso' | 'error' } | null {
  if (s.avisos.includes('EN_GRACIA')) {
    const hasta = s.finGracia
      ? ` el ${fecha.format(new Date(s.finGracia))}`
      : ' el fin del período de gracia';
    return {
      texto: `Tu pago está pendiente. Tienes hasta${hasta} para pagar sin que tu barbería deje de recibir reservas.`,
      tono: 'aviso',
    };
  }
  if (s.avisos.includes('VENCIDA') || s.estado === 'CANCELLED') {
    return {
      texto:
        'Tu suscripción venció: tu barbería no recibe reservas nuevas y no puedes cambiar la configuración. ' +
        'Tus datos y tus citas se conservan, y al pagar todo vuelve a funcionar de inmediato.',
      tono: 'error',
    };
  }
  if (s.avisos.includes('SUSPENDIDA')) {
    return {
      texto: `Tu suscripción está suspendida${s.motivoSuspension ? `: ${s.motivoSuspension}` : '.'} Tu barbería no recibe reservas nuevas.`,
      tono: 'error',
    };
  }
  return null;
}

/**
 * T062 · Aviso del panel cuando la suscripción está en gracia, vencida o suspendida (FR-006, FR-007, FR-039).
 * El propietario ve el estado, la fecha y el acceso a pagar; el barbero, solo que la barbería no acepta
 * reservas (no ve el estado de la suscripción). Se vuelve a consultar cuando una operación recibe 403
 * SUSCRIPCION_NO_PERMITE, por si el estado cambió mientras la pantalla estaba abierta.
 */
export function AvisoSuscripcion() {
  const { usuario } = useSesion();
  const { pathname } = useLocation();
  const consultas = useQueryClient();
  const esPropietario = usuario?.rol === 'PROPIETARIO';
  const suscripcion = useQuery({
    queryKey: ['suscripcion'],
    queryFn: apiSuscripcion.suscripcion,
    enabled: esPropietario,
  });
  const operativo = useQuery({
    queryKey: ['suscripcion', 'estado-operativo'],
    queryFn: apiSuscripcion.estadoOperativo,
    enabled: usuario !== null && !esPropietario,
  });

  useEffect(
    () =>
      suscribirRestriccionSuscripcion(() => void consultas.invalidateQueries({ queryKey: ['suscripcion'] })),
    [consultas],
  );

  let aviso: { texto: string; tono: 'aviso' | 'error' } | null = null;
  if (esPropietario && suscripcion.data) aviso = textoParaPropietario(suscripcion.data);
  if (!esPropietario && operativo.data && !operativo.data.aceptaReservas) {
    aviso = { texto: operativo.data.mensaje ?? 'Esta barbería no acepta reservas por ahora.', tono: 'error' };
  }
  // En la pantalla de la suscripción el propietario ya ve los mismos avisos junto al estado.
  if (!aviso || (esPropietario && pathname === '/app/suscripcion')) return null;

  return (
    <div
      className={aviso.tono === 'error' ? `${estilos.aviso} ${estilos.error}` : estilos.aviso}
      role="status"
      data-aviso-suscripcion=""
    >
      <Icono nombre="alerta" tamano={20} />
      <p>{aviso.texto}</p>
      {esPropietario && (
        <Link to="/app/suscripcion" className={clasesBoton({ variante: 'secundario', tamano: 'sm' })}>
          Pagar ahora
        </Link>
      )}
    </div>
  );
}
