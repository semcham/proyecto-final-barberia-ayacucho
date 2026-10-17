import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type Actor,
  Autorizacion,
} from '../../../src/modules/acceso-barberias/identidad/application/autorizacion';
import { AccesoDenegado } from '../../../src/modules/acceso-barberias/identidad/domain/errores';
import {
  OPERACIONES,
  type Operacion,
  Permisos,
} from '../../../src/modules/acceso-barberias/identidad/domain/permisos';
import type { CodigoRol } from '../../../src/modules/acceso-barberias/identidad/domain/rol';
import type { AuditLog, EntradaAuditoria, TenantId } from '../../../src/shared';

// T035 · Autorización en la capa de aplicación (R22).

class AuditoriaEnMemoria {
  readonly registros: { entrada: EntradaAuditoria; tenantId: string }[] = [];
  async registrar(): Promise<void> {
    throw new Error('Una denegación debe registrarse en transacción propia');
  }
  async registrarEnTransaccionPropia(entrada: EntradaAuditoria, tenantId: TenantId): Promise<void> {
    this.registros.push({ entrada, tenantId: tenantId.valor });
  }
}

const TENANT = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const actor = (rol: CodigoRol): Actor => ({
  usuarioId: `usuario-${rol}`,
  tenantId: TENANT,
  rol,
  sesionId: 's1',
});

describe('Autorizacion.exigir', () => {
  let auditoria: AuditoriaEnMemoria;
  let autorizacion: Autorizacion;

  beforeEach(() => {
    auditoria = new AuditoriaEnMemoria();
    autorizacion = new Autorizacion(auditoria as unknown as AuditLog);
  });

  it.each([
    'LISTAR_USUARIOS',
    'VER_USUARIO',
    'CREAR_USUARIO',
    'ACTUALIZAR_USUARIO',
    'REGENERAR_ACTIVACION',
  ] as const)('un BARBERO no puede %s y la denegación queda auditada', async (operacion) => {
    await expect(autorizacion.exigir(actor('BARBERO'), operacion)).rejects.toBeInstanceOf(AccesoDenegado);
    expect(auditoria.registros).toEqual([
      {
        entrada: {
          accion: 'ACCESO_DENEGADO_ROL',
          actorId: 'usuario-BARBERO',
          recurso: `operacion:${operacion}`,
          resultado: 'DENEGADO',
        },
        tenantId: TENANT,
      },
    ]);
  });

  it.each(['VER_USUARIO_ACTUAL', 'CERRAR_SESION'] as const)(
    'BARBERO y PROPIETARIO pueden %s',
    async (operacion) => {
      await expect(autorizacion.exigir(actor('BARBERO'), operacion)).resolves.toBeUndefined();
      await expect(autorizacion.exigir(actor('PROPIETARIO'), operacion)).resolves.toBeUndefined();
      expect(auditoria.registros).toHaveLength(0);
    },
  );

  it('el PROPIETARIO puede todas las operaciones protegidas (salvo cambiar de barbería) sin denegaciones', async () => {
    for (const operacion of OPERACIONES.filter((op) => op !== 'CAMBIAR_BARBERIA')) {
      await expect(autorizacion.exigir(actor('PROPIETARIO'), operacion)).resolves.toBeUndefined();
    }
    expect(auditoria.registros).toHaveLength(0);
  });
});

describe('La matriz Permisos coincide con contracts/rbac.md', () => {
  const RBAC_MD = join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'specs',
    '001-registro-acceso-barberia',
    'contracts',
    'rbac.md',
  );

  // Fila de rbac.md → operaciones protegidas que representa. Las filas públicas no tienen operación.
  const OPERACIONES_POR_FILA: [string, Operacion[]][] = [
    ['`POST /auth/logout`', ['CERRAR_SESION']],
    ['`GET /auth/yo`', ['VER_USUARIO_ACTUAL']],
    ['`GET /usuarios`, `GET /usuarios/{id}`', ['LISTAR_USUARIOS', 'VER_USUARIO']],
    ['`POST /usuarios`', ['CREAR_USUARIO']],
    ['`PATCH /usuarios/{id}`', ['ACTUALIZAR_USUARIO']],
    ['`POST /usuarios/{id}/activacion`', ['REGENERAR_ACTIVACION']],
  ];

  const filas = readFileSync(RBAC_MD, 'utf8')
    .split(/\r?\n/)
    .filter((linea) => linea.startsWith('| `'))
    .map((linea) =>
      linea
        .split('|')
        .slice(1, -1)
        .map((celda) => celda.trim()),
    );

  it('la tabla tiene las columnas PUB, PROPIETARIO y BARBERO', () => {
    const encabezado = readFileSync(RBAC_MD, 'utf8')
      .split(/\r?\n/)
      .find((linea) => linea.startsWith('| Operación'));
    expect(
      encabezado
        ?.split('|')
        .map((celda) => celda.trim())
        .filter(Boolean),
    ).toEqual(['Operación', 'PUB', 'PROPIETARIO', 'BARBERO']);
  });

  it('cada operación protegida de 001 aparece en la tabla de 001', () => {
    // Las operaciones de M01 agregadas por la funcionalidad 002 se comparan con su rbac.md en
    // test/unit/catalogo/permisos-rango.spec.ts.
    const DE_002 = [
      'CAMBIAR_BARBERIA',
      'VER_BARBERIA',
      'ACTUALIZAR_BARBERIA',
      'BUSCAR_CLIENTES',
      'REGISTRAR_CLIENTE_PRESENCIAL',
    ];
    const cubiertas = OPERACIONES_POR_FILA.flatMap(([, operaciones]) => operaciones).sort();
    expect(cubiertas).toEqual(OPERACIONES.filter((op) => !DE_002.includes(op)).sort());
  });

  it.each(OPERACIONES_POR_FILA)(
    '%s: la matriz del código coincide con la del contrato',
    (prefijo, operaciones) => {
      const fila = filas.find(([celda]) => celda.startsWith(prefijo));
      expect(fila).toBeDefined();
      const [, , propietario, barbero] = fila as string[];
      const permitido = (celda: string) => celda.startsWith('✓');
      for (const operacion of operaciones) {
        expect(Permisos.permite('PROPIETARIO', operacion)).toBe(permitido(propietario));
        expect(Permisos.permite('BARBERO', operacion)).toBe(permitido(barbero));
      }
    },
  );
});
