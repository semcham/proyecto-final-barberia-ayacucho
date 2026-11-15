// T040 de 005 · Las intenciones del esquema cerrado (contracts/asistente.md §2) y las herramientas CERRADAS de cada rol
// (contracts/rbac.md de 005, FR-003): un rol no puede usar las del otro aunque el modelo las pida. Desde la fase 4
// (US3) el propietario tiene las suyas: el resumen de citas y los servicios más pedidos (FR-027).

export type RolDelAsistente = 'CLIENTE' | 'PROPIETARIO';

export const INTENCIONES_DEL_CLIENTE = ['servicios', 'barberos', 'horarios_libres'] as const;
export const INTENCIONES_DEL_PROPIETARIO = ['resumen_citas', 'servicios_mas_pedidos'] as const;
export const INTENCIONES_GENERICAS = ['fuera_de_alcance', 'accion_no_permitida'] as const;

export type IntencionDeHerramienta =
  (typeof INTENCIONES_DEL_CLIENTE)[number] | (typeof INTENCIONES_DEL_PROPIETARIO)[number];
export type Intencion = IntencionDeHerramienta | (typeof INTENCIONES_GENERICAS)[number];

export const HERRAMIENTAS_POR_ROL: Readonly<Record<RolDelAsistente, readonly IntencionDeHerramienta[]>> = {
  CLIENTE: [...INTENCIONES_DEL_CLIENTE],
  PROPIETARIO: [...INTENCIONES_DEL_PROPIETARIO],
};

/** Lo que se le dice al modelo que puede elegir: las herramientas del rol y las dos genéricas. */
export function intencionesPermitidas(rol: RolDelAsistente): string[] {
  return [...HERRAMIENTAS_POR_ROL[rol], ...INTENCIONES_GENERICAS];
}

export function tieneAsistente(rol: RolDelAsistente): boolean {
  return HERRAMIENTAS_POR_ROL[rol].length > 0;
}
