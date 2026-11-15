import {
  HERRAMIENTAS_POR_ROL,
  intencionesPermitidas,
  tieneAsistente,
} from '../../../src/modules/asistente-reportes/asistente/domain/herramientas';
import { validarIntencion } from '../../../src/modules/asistente-reportes/asistente/domain/intencion';

// T026 de 005 · FR-001, FR-003, FR-006 y contracts/asistente.md §2: el esquema de intenciones es cerrado. Lo que el
// modelo devuelve se valida en el backend: una intención fuera de la lista, de otro rol o con argumentos que el
// esquema no admite es fuera_de_alcance; pedir reservar, cancelar o cambiar es accion_no_permitida. Cualquier texto
// del modelo se ignora (lo descarta leerInterpretacion del puerto; aquí ni siquiera llega).

const deCliente = (intencion: string, argumentos: Record<string, unknown> = {}) =>
  validarIntencion('CLIENTE', { intencion, argumentos });

describe('Herramientas por rol (contracts/rbac.md de 005)', () => {
  it('el cliente tiene exactamente servicios, barberos y horarios_libres', () => {
    expect(HERRAMIENTAS_POR_ROL.CLIENTE).toEqual(['servicios', 'barberos', 'horarios_libres']);
    expect(intencionesPermitidas('CLIENTE')).toEqual([
      'servicios',
      'barberos',
      'horarios_libres',
      'fuera_de_alcance',
      'accion_no_permitida',
    ]);
    expect(tieneAsistente('CLIENTE')).toBe(true);
  });

  it('T052 · el propietario tiene exactamente resumen_citas y servicios_mas_pedidos', () => {
    expect(HERRAMIENTAS_POR_ROL.PROPIETARIO).toEqual(['resumen_citas', 'servicios_mas_pedidos']);
    expect(intencionesPermitidas('PROPIETARIO')).toEqual([
      'resumen_citas',
      'servicios_mas_pedidos',
      'fuera_de_alcance',
      'accion_no_permitida',
    ]);
    expect(tieneAsistente('PROPIETARIO')).toBe(true);
  });
});

describe('validarIntencion: esquema cerrado (T026)', () => {
  it('servicios, sin argumentos', () => {
    expect(deCliente('servicios')).toEqual({ tipo: 'servicios' });
  });

  it('barberos con el servicio', () => {
    expect(deCliente('barberos', { servicio: 'corte' })).toEqual({ tipo: 'barberos', servicio: 'corte' });
  });

  it('horarios_libres con servicio, fecha y barbero (opcional)', () => {
    expect(deCliente('horarios_libres', { servicio: 'corte', fecha: '2026-11-15', barbero: 'luis' })).toEqual(
      {
        tipo: 'horarios_libres',
        servicio: 'corte',
        fecha: '2026-11-15',
        barbero: 'luis',
      },
    );
    expect(deCliente('horarios_libres', { servicio: 'corte', fecha: '2026-11-15' })).toEqual({
      tipo: 'horarios_libres',
      servicio: 'corte',
      fecha: '2026-11-15',
    });
  });

  it('un argumento obligatorio que falta no es fuera de alcance: se pide después (SIN_DATOS)', () => {
    expect(deCliente('horarios_libres', { fecha: '2026-11-15' })).toEqual({
      tipo: 'horarios_libres',
      fecha: '2026-11-15',
    });
  });

  it.each([
    ['una intención que no existe', 'sql', { consulta: 'SELECT * FROM appointment' }],
    ['otra intención inventada', 'listar_clientes', {}],
    [
      'un argumento que el esquema no admite (barbería)',
      'horarios_libres',
      { servicio: 'corte', barberia: 'otra' },
    ],
    ['un argumento que el esquema no admite (cliente)', 'horarios_libres', { cliente: 'Rocío' }],
    ['un argumento de tenant', 'servicios', { tenantId: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b' }],
    ['un texto que no es texto', 'barberos', { servicio: 42 }],
    ['un texto de más de 80 caracteres', 'barberos', { servicio: 'x'.repeat(81) }],
    ['una fecha con otro formato', 'horarios_libres', { servicio: 'corte', fecha: '15/11/2026' }],
  ])('%s → fuera_de_alcance', (_caso, intencion, argumentos) => {
    expect(deCliente(intencion, argumentos)).toEqual({ tipo: 'fuera_de_alcance' });
  });

  it('una fecha con el formato correcto pasa el esquema aunque no exista (la explica la resolución)', () => {
    expect(deCliente('horarios_libres', { servicio: 'corte', fecha: '2026-13-45' })).toMatchObject({
      tipo: 'horarios_libres',
      fecha: '2026-13-45',
    });
  });

  it.each(['resumen_citas', 'servicios_mas_pedidos'])(
    'el cliente pide %s (del propietario) → fuera_de_alcance',
    (i) => {
      expect(deCliente(i, { desde: '2026-11-01', hasta: '2026-11-30' })).toEqual({
        tipo: 'fuera_de_alcance',
      });
    },
  );

  it.each(['reservar', 'cancelar_cita', 'reprogramar', 'cambiar_cita', 'anular', 'accion_no_permitida'])(
    '%s → accion_no_permitida',
    (intencion) => {
      expect(deCliente(intencion, { hora: '10:00' })).toEqual({ tipo: 'accion_no_permitida' });
    },
  );

  it('fuera_de_alcance se respeta', () => {
    expect(deCliente('fuera_de_alcance')).toEqual({ tipo: 'fuera_de_alcance' });
  });

  it.each([
    ['servicios', {}],
    ['barberos', { servicio: 'corte' }],
    ['horarios_libres', { servicio: 'corte', fecha: '2026-11-15' }],
  ])('el propietario pide %s (del cliente) → fuera_de_alcance', (intencion, argumentos) => {
    expect(validarIntencion('PROPIETARIO', { intencion, argumentos })).toEqual({ tipo: 'fuera_de_alcance' });
  });

  it.each(['resumen_citas', 'servicios_mas_pedidos'] as const)(
    'el propietario: %s con desde y hasta',
    (tipo) => {
      expect(
        validarIntencion('PROPIETARIO', {
          intencion: tipo,
          argumentos: { desde: '2026-11-01', hasta: '2026-11-14' },
        }),
      ).toEqual({ tipo, desde: '2026-11-01', hasta: '2026-11-14' });
    },
  );

  it.each([
    ['incluir clientes', { desde: '2026-11-01', hasta: '2026-11-14', incluir: 'clientes' }],
    ['un cliente', { desde: '2026-11-01', cliente: 'Rocío' }],
    ['otra barbería', { desde: '2026-11-01', barberia: 'otra' }],
    ['una fecha con otro formato', { desde: '01/11/2026', hasta: '2026-11-14' }],
  ])('el propietario con %s → fuera_de_alcance (PR19, caso 9)', (_caso, argumentos) => {
    expect(validarIntencion('PROPIETARIO', { intencion: 'servicios_mas_pedidos', argumentos })).toEqual({
      tipo: 'fuera_de_alcance',
    });
  });
});
