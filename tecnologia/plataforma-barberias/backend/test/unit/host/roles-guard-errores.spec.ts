import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESTADO_POR_CODIGO } from '../../../src/host/error.filter';
import { rolPermiteOperacion } from '../../../src/host/roles.guard';

// T033 · RolesGuard con las matrices de M01 y M02 · T034 · estados HTTP de los códigos de 002.

describe('rolPermiteOperacion (RolesGuard)', () => {
  it('usa la matriz de M01 para sus operaciones, también con el rol CLIENTE', () => {
    expect(rolPermiteOperacion('PROPIETARIO', 'LISTAR_USUARIOS')).toBe(true);
    expect(rolPermiteOperacion('CLIENTE', 'LISTAR_USUARIOS')).toBe(false);
    expect(rolPermiteOperacion('CLIENTE', 'CERRAR_SESION')).toBe(true);
    expect(rolPermiteOperacion('CLIENTE', 'CAMBIAR_BARBERIA')).toBe(true);
    expect(rolPermiteOperacion('BARBERO', 'CAMBIAR_BARBERIA')).toBe(false);
  });

  it('usa la matriz de M02 para sus operaciones', () => {
    expect(rolPermiteOperacion('CLIENTE', 'RESERVAR_CITA')).toBe(true);
    expect(rolPermiteOperacion('BARBERO', 'RESERVAR_CITA')).toBe(false);
    expect(rolPermiteOperacion('BARBERO', 'VER_AGENDA')).toBe(true);
    expect(rolPermiteOperacion('CLIENTE', 'GESTIONAR_SERVICIOS')).toBe(false);
  });

  it('una operación que no está en ninguna matriz es un error de programación', () => {
    expect(() => rolPermiteOperacion('PROPIETARIO', 'BORRAR_TODO')).toThrow(/desconocida/);
  });
});

describe('ErrorFilter: estados HTTP de los códigos de 002 (contracts/openapi.yaml)', () => {
  it.each([
    ['BARBERIA_NO_DISPONIBLE', 404],
    ['CONFLICTO_CON_CITAS', 409],
    ['HORARIO_NO_DISPONIBLE', 409],
    ['CITA_SOLAPADA_DEL_CLIENTE', 409],
    ['INGRESA_DESDE_TU_BARBERIA', 409],
    ['UNIRSE_REQUIERE_CONSENTIMIENTO', 409],
    ['CUENTA_DE_PERSONAL', 409],
    ['ENLACE_NO_DISPONIBLE', 409],
    ['NOMBRE_DUPLICADO', 409],
    ['USUARIO_YA_VINCULADO', 409],
    ['RESERVA_INVALIDA', 422],
    ['IDEMPOTENCIA_CONFLICTO', 422],
    ['TRANSICION_INVALIDA', 422],
    ['FUERA_DEL_HORARIO_DE_ATENCION', 422],
  ])('%s → %i', (codigo, estado) => {
    expect(ESTADO_POR_CODIGO[codigo]).toBe(estado);
  });

  it('todos los códigos nuevos que lista el contrato tienen estado', () => {
    const contrato = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'specs',
        '002-catalogo-citas-cliente',
        'contracts',
        'openapi.yaml',
      ),
      'utf8',
    );
    const lista = /Códigos nuevos: ([^.]+)\./.exec(contrato.replace(/\s+/g, ' '));
    expect(lista).not.toBeNull();
    const codigos = (lista as RegExpExecArray)[1].split(',').map((codigo) => codigo.trim());
    expect(codigos.filter((codigo) => ESTADO_POR_CODIGO[codigo] === undefined)).toEqual([]);
  });
});
