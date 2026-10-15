// Registro de endpoints protegidos que recorre la suite PR09 (aislamiento-tenant.spec.ts).
// Cada historia que agrega endpoints protegidos los añade aquí (US4: /usuarios).

export interface EndpointProtegido {
  metodo: 'get' | 'post' | 'patch';
  ruta: string;
  /** Cuerpo válido para la operación; los ataques le agregan campos de tenant. */
  cuerpo?: Record<string, unknown>;
}

export const ENDPOINTS_PROTEGIDOS: EndpointProtegido[] = [
  { metodo: 'get', ruta: '/api/v1/auth/yo' },
  { metodo: 'post', ruta: '/api/v1/auth/logout', cuerpo: {} },
];
