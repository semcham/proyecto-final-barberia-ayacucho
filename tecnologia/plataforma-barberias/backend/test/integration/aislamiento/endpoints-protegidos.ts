// Registro de endpoints protegidos que recorre la suite PR09 (aislamiento-tenant.spec.ts).
// Cada historia que agrega endpoints protegidos los añade aquí. En `ruta`, `{idUsuarioPropio}` se
// reemplaza por un usuario de la propia barbería del token (el ataque es el campo de tenant, no el id).

export interface EndpointProtegido {
  metodo: 'get' | 'post' | 'patch';
  ruta: string;
  /** Cuerpo válido para la operación; los ataques le agregan campos de tenant. */
  cuerpo?: Record<string, unknown>;
}

export const ENDPOINTS_PROTEGIDOS: EndpointProtegido[] = [
  // US2
  { metodo: 'get', ruta: '/api/v1/auth/yo' },
  { metodo: 'post', ruta: '/api/v1/auth/logout', cuerpo: {} },
  // US4
  { metodo: 'get', ruta: '/api/v1/usuarios' },
  { metodo: 'get', ruta: '/api/v1/usuarios/{idUsuarioPropio}' },
  {
    metodo: 'post',
    ruta: '/api/v1/usuarios',
    cuerpo: { nombre: 'Barbero Atacante', correo: 'atacante@prueba.pe', rol: 'BARBERO' },
  },
  { metodo: 'patch', ruta: '/api/v1/usuarios/{idUsuarioPropio}', cuerpo: { estado: 'DESACTIVADA' } },
  { metodo: 'post', ruta: '/api/v1/usuarios/{idUsuarioPropio}/activacion', cuerpo: {} },
];
