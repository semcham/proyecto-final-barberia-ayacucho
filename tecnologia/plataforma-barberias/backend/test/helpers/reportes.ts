import { v7 as uuidv7 } from 'uuid';
import type { AppDePrueba } from './app';
import { poolDe } from './test-db';

// 005 (fase 2, US2): ayudas de las pruebas de los reportes del propietario (GET /reportes).

export type EstadoDeCita = 'PENDIENTE' | 'CONFIRMADA' | 'COMPLETADA' | 'NO_ASISTIO' | 'CANCELADA';

/** GET /api/v1/reportes con el token dado (o sin sesión), y los parámetros que se pasen tal cual. */
export function pedirReportes(
  prueba: AppDePrueba,
  token: string | null,
  parametros: Record<string, string> = {},
  encabezados: Record<string, string> = {},
) {
  const consulta = new URLSearchParams(parametros).toString();
  const solicitud = prueba.agente.get(`/api/v1/reportes${consulta ? `?${consulta}` : ''}`);
  if (token) solicitud.set('Authorization', `Bearer ${token}`);
  for (const [nombre, valor] of Object.entries(encabezados)) solicitud.set(nombre, valor);
  return solicitud;
}

/**
 * Una cita sembrada sin RLS con el estado, la hora de inicio (ISO con desplazamiento) y el nombre del servicio que
 * tenía al reservarse (`service_name`, FR-022). Una cancelada lleva su fecha de cancelación y, si se pide, la marca
 * de tardía.
 */
export async function sembrarCitaDeReporte(opciones: {
  tenantId: string;
  barberoId: string;
  servicioId: string;
  clienteId: string;
  inicio: string;
  estado: EstadoDeCita;
  servicio?: string;
  tardia?: boolean;
}): Promise<string> {
  const id = uuidv7();
  const inicio = new Date(opciones.inicio);
  const fin = new Date(inicio.getTime() + 30 * 60_000);
  await poolDe('seed').query(
    `INSERT INTO appointment
       (id, tenant_id, barber_id, service_id, customer_id, service_name, price, duration_min,
        starts_at, ends_at, status, origin, created_by, cancelled_at, late_cancellation)
     VALUES ($1, $2, $3, $4, $5, $6, '20.00', 30, $7, $8, $9, 'EN_LINEA', $10, $11, $12)`,
    [
      id,
      opciones.tenantId,
      opciones.barberoId,
      opciones.servicioId,
      opciones.clienteId,
      opciones.servicio ?? 'Corte clásico',
      inicio,
      fin,
      opciones.estado,
      uuidv7(),
      opciones.estado === 'CANCELADA' ? inicio : null,
      opciones.estado === 'CANCELADA' && opciones.tardia === true,
    ],
  );
  return id;
}

/** Siete días de la semana (1 = lunes … 7 = domingo) con las citas dadas; el resto en cero. */
export function porDiaDeSemana(citas: Partial<Record<1 | 2 | 3 | 4 | 5 | 6 | 7, number>>) {
  return ([1, 2, 3, 4, 5, 6, 7] as const).map((dia) => ({ dia, citas: citas[dia] ?? 0 }));
}
