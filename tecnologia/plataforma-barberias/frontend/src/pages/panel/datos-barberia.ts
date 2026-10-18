import { useQuery } from '@tanstack/react-query';
import { clavesConsulta } from '../../api/claves';
import { ApiError, llamarApi } from '../../api/client';
import type { components } from '../../api/schema-002';

export type BarberiaConfig = components['schemas']['BarberiaConfig'];

/** Configuración de la barbería del token (GET /barberia, PROPIETARIO y BARBERO). */
export function useBarberia() {
  return useQuery({
    queryKey: clavesConsulta.barberia,
    queryFn: () => llamarApi<BarberiaConfig>('/barberia'),
  });
}

/** Zona horaria de la barbería para mostrar horas; mientras carga, la única admitida hoy (R07). */
export function useZonaBarberia(): string {
  return useBarberia().data?.zonaHoraria ?? 'America/Lima';
}

/** Mensaje de un error de la API en las pantallas del panel. */
export function mensajeDeError(error: unknown): string {
  if (!(error instanceof ApiError)) return 'No pudimos conectar con el servidor. Intenta de nuevo.';
  return error.message;
}
