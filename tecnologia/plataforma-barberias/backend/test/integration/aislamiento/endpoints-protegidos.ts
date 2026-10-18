// Registro de endpoints protegidos que recorre la suite PR09 (aislamiento-tenant.spec.ts).
// Cada historia que agrega endpoints protegidos los añade aquí. En `ruta`, los marcadores `{id…Propio}` se
// reemplazan por recursos de la propia barbería del token (el ataque es el campo de tenant, no el id):
// `{idUsuarioPropio}`, `{idServicioPropio}`, `{idBarberoPropio}` y `{idBloqueoPropio}`.

export interface EndpointProtegido {
  metodo: 'get' | 'post' | 'patch' | 'put' | 'delete';
  ruta: string;
  /** Cuerpo válido para la operación; los ataques le agregan campos de tenant. */
  cuerpo?: Record<string, unknown>;
}

const BLOQUEO_VALIDO = { inicio: '2030-01-08T10:00:00-05:00', fin: '2030-01-08T11:00:00-05:00' };

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
  // Funcionalidad 002 · US1 (T047): barbería, horario, servicios, barberos, disponibilidad y bloqueos.
  { metodo: 'get', ruta: '/api/v1/barberia' },
  { metodo: 'patch', ruta: '/api/v1/barberia', cuerpo: { descripcion: 'Atacada' } },
  { metodo: 'get', ruta: '/api/v1/barberia/horario' },
  { metodo: 'put', ruta: '/api/v1/barberia/horario', cuerpo: { tramos: [] } },
  { metodo: 'get', ruta: '/api/v1/servicios' },
  {
    metodo: 'post',
    ruta: '/api/v1/servicios',
    cuerpo: { nombre: 'Servicio atacante', precio: '1', duracionMinutos: 30 },
  },
  { metodo: 'patch', ruta: '/api/v1/servicios/{idServicioPropio}', cuerpo: { precio: '1' } },
  { metodo: 'get', ruta: '/api/v1/barberos' },
  { metodo: 'post', ruta: '/api/v1/barberos', cuerpo: { nombre: 'Barbero atacante', servicioIds: [] } },
  { metodo: 'patch', ruta: '/api/v1/barberos/{idBarberoPropio}', cuerpo: { nombre: 'Atacado' } },
  { metodo: 'get', ruta: '/api/v1/barberos/{idBarberoPropio}/disponibilidad' },
  { metodo: 'put', ruta: '/api/v1/barberos/{idBarberoPropio}/disponibilidad', cuerpo: { tramos: [] } },
  { metodo: 'get', ruta: '/api/v1/barberos/{idBarberoPropio}/bloqueos' },
  { metodo: 'post', ruta: '/api/v1/barberos/{idBarberoPropio}/bloqueos', cuerpo: BLOQUEO_VALIDO },
  { metodo: 'delete', ruta: '/api/v1/barberos/{idBarberoPropio}/bloqueos/{idBloqueoPropio}' },
  // Funcionalidad 002 · US4 (T102): agenda, estados de la cita y clientes presenciales.
  { metodo: 'get', ruta: '/api/v1/agenda?fecha=2030-01-09' },
  { metodo: 'post', ruta: '/api/v1/citas/{idCitaPropia}/estado', cuerpo: { estado: 'COMPLETADA' } },
  // US5 (T114).
  { metodo: 'post', ruta: '/api/v1/citas/{idCitaPropia}/cancelar', cuerpo: { motivo: 'Ataque' } },
  { metodo: 'get', ruta: '/api/v1/clientes?buscar=cliente' },
  {
    metodo: 'post',
    ruta: '/api/v1/clientes',
    cuerpo: {
      nombre: 'Cliente Atacante',
      telefono: '966000111',
      consentimientoVerbal: true,
      versionPoliticaDatos: '2026-10',
    },
  },
];

/**
 * Operaciones de US1 de 002 con identificadores de la barbería B y el token de A (T047). Todas deben
 * responder 404 `NO_ENCONTRADO` sin cambiar nada en B: con RLS y el filtro por tenant, los recursos de B no
 * existen para A. Marcadores: `{servicioB}`, `{barberoB}`, `{bloqueoB}` y `{barberoA}`.
 */
export const OPERACIONES_CON_IDS_DE_B: EndpointProtegido[] = [
  { metodo: 'patch', ruta: '/api/v1/servicios/{servicioB}', cuerpo: { precio: '1' } },
  {
    metodo: 'patch',
    ruta: '/api/v1/servicios/{servicioB}',
    cuerpo: { activo: false, confirmarConflictos: true },
  },
  { metodo: 'patch', ruta: '/api/v1/barberos/{barberoB}', cuerpo: { nombre: 'Atacado' } },
  {
    metodo: 'patch',
    ruta: '/api/v1/barberos/{barberoB}',
    cuerpo: { activo: false, confirmarConflictos: true },
  },
  { metodo: 'get', ruta: '/api/v1/barberos/{barberoB}/disponibilidad' },
  { metodo: 'put', ruta: '/api/v1/barberos/{barberoB}/disponibilidad', cuerpo: { tramos: [] } },
  { metodo: 'get', ruta: '/api/v1/barberos/{barberoB}/bloqueos' },
  { metodo: 'post', ruta: '/api/v1/barberos/{barberoB}/bloqueos', cuerpo: BLOQUEO_VALIDO },
  { metodo: 'delete', ruta: '/api/v1/barberos/{barberoB}/bloqueos/{bloqueoB}' },
  // Barbero propio con el bloqueo de B: tampoco existe para A.
  { metodo: 'delete', ruta: '/api/v1/barberos/{barberoA}/bloqueos/{bloqueoB}' },
  // US4 (T102): cambiar el estado de una cita de B.
  { metodo: 'post', ruta: '/api/v1/citas/{citaB}/estado', cuerpo: { estado: 'COMPLETADA' } },
  { metodo: 'post', ruta: '/api/v1/citas/{citaB}/estado', cuerpo: { estado: 'NO_ASISTIO' } },
  // US5 (T114): cancelar una cita de B.
  { metodo: 'post', ruta: '/api/v1/citas/{citaB}/cancelar', cuerpo: { motivo: 'Ataque' } },
  { metodo: 'post', ruta: '/api/v1/citas/{citaB}/cancelar' },
];
