import { Consentimiento } from '../../../src/modules/acceso-barberias/clientes/domain/consentimiento';
import {
  PerfilCliente,
  Telefono,
} from '../../../src/modules/acceso-barberias/clientes/domain/perfil-cliente';
import { Correo } from '../../../src/modules/acceso-barberias/identidad/domain/correo';
import { ValorInvalido } from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import { NombrePersona } from '../../../src/modules/acceso-barberias/identidad/domain/nombre-persona';

// T083 · Dominio de clientes (RF05, FR-024, FR-035).

function problemaDe(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValorInvalido) return error.detalles[0].problema as string;
    throw error;
  }
  return undefined;
}

describe('Telefono', () => {
  it.each(['966123456', '+51 966 123 456', '066-123'.replace('-', ' ')])('acepta %j', (valor) => {
    expect(Telefono.crear(valor).valor).toBe(valor.trim());
  });
  it.each(['abc', '12345', '966-123-456', '', '1'.repeat(21)])('rechaza %j', (valor) => {
    expect(problemaDe(() => Telefono.crear(valor))).toBe('formato');
  });
});

describe('PerfilCliente', () => {
  it('en línea: con cuenta y correo, origen EN_LINEA', () => {
    const perfil = PerfilCliente.enLinea({
      id: 'p1',
      tenantId: 't1',
      usuarioId: 'u1',
      nombre: NombrePersona.crear('Rosa Quispe'),
      correo: Correo.crear('Rosa@Mail.pe '),
      telefono: Telefono.crear('966123456'),
    });
    expect(perfil.origen).toBe('EN_LINEA');
    expect(perfil.correo?.valor).toBe('rosa@mail.pe');
    expect(perfil.creadoPor).toBeNull();
  });

  it('presencial: sin cuenta, con quien lo registró', () => {
    const perfil = PerfilCliente.presencial({
      id: 'p2',
      tenantId: 't1',
      nombre: NombrePersona.crear('Juan Pérez'),
      correo: null,
      telefono: Telefono.crear('966123456'),
      creadoPor: 'propietario-1',
    });
    expect(perfil.origen).toBe('PRESENCIAL');
    expect(perfil.usuarioId).toBeNull();
    expect(perfil.creadoPor).toBe('propietario-1');
  });
});

describe('Consentimiento', () => {
  it('en línea: exige la aceptación expresa y la versión vigente', () => {
    expect(Consentimiento.enLinea(true, '2026-10', '2026-10')).toMatchObject({
      metodo: 'EN_LINEA',
      version: '2026-10',
    });
    expect(problemaDe(() => Consentimiento.enLinea(false, '2026-10', '2026-10'))).toBe('requerido');
    expect(problemaDe(() => Consentimiento.enLinea(undefined, '2026-10', '2026-10'))).toBe('requerido');
    expect(problemaDe(() => Consentimiento.enLinea(true, '2020-01', '2026-10'))).toBe('no_vigente');
    expect(problemaDe(() => Consentimiento.enLinea(true, '', ''))).toBe('no_vigente');
  });

  it('presencial: exige la constancia verbal y quién la anotó', () => {
    expect(Consentimiento.presencial(true, '2026-10', '2026-10', 'propietario-1')).toMatchObject({
      metodo: 'PRESENCIAL',
      registradoPor: 'propietario-1',
    });
    expect(problemaDe(() => Consentimiento.presencial(false, '2026-10', '2026-10', 'p'))).toBe('requerido');
    expect(problemaDe(() => Consentimiento.presencial(true, '2026-10', '2026-10', ''))).toBe('requerido');
  });
});
