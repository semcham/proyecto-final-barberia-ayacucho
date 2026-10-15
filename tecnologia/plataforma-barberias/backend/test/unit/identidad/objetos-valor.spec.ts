import { Contrasena } from '../../../src/modules/acceso-barberias/identidad/domain/contrasena';
import { Correo } from '../../../src/modules/acceso-barberias/identidad/domain/correo';
import { ValorInvalido } from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import { OPERACIONES, Permisos } from '../../../src/modules/acceso-barberias/identidad/domain/permisos';
import { Rol } from '../../../src/modules/acceso-barberias/identidad/domain/rol';

function problemaDe(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    if (error instanceof ValorInvalido) return error.detalles[0]?.problema;
    throw error;
  }
  return undefined;
}

describe('Correo', () => {
  it('normaliza espacios y mayúsculas (FR-029)', () => {
    expect(Correo.crear('  Ana@Mail.com ').valor).toBe('ana@mail.com');
    expect(Correo.crear('Ana@Mail.com ').equals(Correo.crear('ana@mail.com'))).toBe(true);
  });

  it.each([
    ['', 'requerido'],
    ['   ', 'requerido'],
    ['sin-arroba.pe', 'formato'],
    ['ana@sindominio', 'formato'],
    ['ana @mail.com', 'formato'],
    ['<script>@x.pe', 'formato'],
    [`${'a'.repeat(250)}@x.pe`, 'demasiado_largo'],
  ])('rechaza %j (%s)', (entrada, problema) => {
    expect(problemaDe(() => Correo.crear(entrada))).toBe(problema);
  });
});

describe('Contrasena', () => {
  const correo = Correo.crear('rosa.quispe@barberia.pe');

  it('acepta una frase larga sin reglas de composición (R16)', () => {
    expect(() => Contrasena.crear('mi barberia en huamanga')).not.toThrow();
  });

  it.each([
    ['corta123', 'muy_corta'],
    ['x'.repeat(129), 'demasiado_larga'],
    ['1234567890', 'muy_comun'],
    ['Password123', 'muy_comun'],
    ['rosa.quispe-2026', 'contiene_correo'],
    ['ROSA.QUISPE@barberia.pe!', 'contiene_correo'],
  ])('rechaza %j (%s)', (texto, problema) => {
    expect(problemaDe(() => Contrasena.crear(texto, correo))).toBe(problema);
  });

  it('cuenta caracteres, no bytes', () => {
    expect(() => Contrasena.crear('ñandú-ñandú')).not.toThrow();
  });

  it('nunca muestra su valor al convertirse en texto', () => {
    const contrasena = Contrasena.crear('mi barberia en huamanga');
    expect(String(contrasena)).not.toContain('huamanga');
    expect(JSON.stringify({ contrasena })).not.toContain('huamanga');
  });
});

describe('Rol', () => {
  it('solo BARBERO es asignable por el propietario (FR-015, FR-017)', () => {
    expect(Rol.de('BARBERO').esAsignablePorPropietario()).toBe(true);
    expect(Rol.de('PROPIETARIO').esAsignablePorPropietario()).toBe(false);
  });

  it.each(['ADMINISTRATIVO', 'CLIENTE', 'ADMIN_PLATAFORMA', 'barbero', ''])('rechaza el rol %j', (codigo) => {
    expect(problemaDe(() => Rol.de(codigo))).toBe('no_permitido');
  });
});

describe('Permisos', () => {
  it('el propietario puede realizar todas las operaciones protegidas', () => {
    for (const operacion of OPERACIONES) expect(Permisos.permite('PROPIETARIO', operacion)).toBe(true);
  });

  it('el barbero solo ve su usuario y cierra su sesión', () => {
    const permitidas = OPERACIONES.filter((operacion) => Permisos.permite('BARBERO', operacion));
    expect(permitidas).toEqual(['VER_USUARIO_ACTUAL', 'CERRAR_SESION']);
  });
});
