import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Actor } from '../../../src/modules/acceso-barberias';
import { type Operacion, Permisos } from '../../../src/modules/acceso-barberias/identidad/domain/permisos';
import { AutorizacionCatalogoCitas } from '../../../src/modules/catalogo-citas/catalogo/application/autorizacion';
import { AccesoDenegado } from '../../../src/modules/catalogo-citas/catalogo/domain/errores';
import {
  OPERACIONES_CATALOGO_CITAS,
  type OperacionCatalogoCitas,
  PermisosCatalogoCitas,
  type RolActor,
} from '../../../src/modules/catalogo-citas/catalogo/domain/permisos';
import {
  RangoHorario,
  RangoInvalido,
} from '../../../src/modules/catalogo-citas/catalogo/domain/rango-horario';
import type { AuditLog, EntradaAuditoria, TenantId } from '../../../src/shared';

// T029 · RangoHorario, autorización de M02 y consistencia de las matrices con contracts/rbac.md de 002.

const t = (iso: string) => new Date(`2026-10-20T${iso}:00-05:00`);

describe('RangoHorario', () => {
  it('rangos contiguos no se solapan (semiabierto [inicio, fin))', () => {
    const primero = RangoHorario.crear(t('10:00'), t('10:30'));
    const segundo = RangoHorario.crear(t('10:30'), t('11:00'));
    expect(primero.seSolapaCon(segundo)).toBe(false);
    expect(segundo.seSolapaCon(primero)).toBe(false);
  });

  it('detecta solapes parciales y totales', () => {
    const base = RangoHorario.crear(t('10:00'), t('10:30'));
    expect(base.seSolapaCon(RangoHorario.crear(t('10:15'), t('10:45')))).toBe(true);
    expect(base.seSolapaCon(RangoHorario.crear(t('09:00'), t('12:00')))).toBe(true);
  });

  it('contieneEnteramente y duración', () => {
    const tramo = RangoHorario.crear(t('09:00'), t('13:00'));
    expect(tramo.contieneEnteramente(RangoHorario.desde(t('12:30'), 30))).toBe(true);
    expect(tramo.contieneEnteramente(RangoHorario.desde(t('12:45'), 30))).toBe(false);
    expect(RangoHorario.desde(t('10:00'), 45).duracionMinutos()).toBe(45);
  });

  it('rechaza inicio mayor o igual que fin', () => {
    expect(() => RangoHorario.crear(t('10:00'), t('10:00'))).toThrow(RangoInvalido);
    expect(() => RangoHorario.crear(t('11:00'), t('10:00'))).toThrow(RangoInvalido);
  });
});

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
const actor = (rol: RolActor): Actor => ({
  usuarioId: `usuario-${rol}`,
  tenantId: TENANT,
  rol,
  sesionId: 's1',
});

describe('AutorizacionCatalogoCitas.exigir', () => {
  let auditoria: AuditoriaEnMemoria;
  let autorizacion: AutorizacionCatalogoCitas;

  beforeEach(() => {
    auditoria = new AuditoriaEnMemoria();
    autorizacion = new AutorizacionCatalogoCitas(auditoria as unknown as AuditLog);
  });

  it('un CLIENTE no puede gestionar servicios y la denegación queda auditada', async () => {
    await expect(autorizacion.exigir(actor('CLIENTE'), 'GESTIONAR_SERVICIOS')).rejects.toBeInstanceOf(
      AccesoDenegado,
    );
    expect(auditoria.registros).toEqual([
      {
        entrada: {
          accion: 'ACCESO_DENEGADO_ROL',
          actorId: 'usuario-CLIENTE',
          recurso: 'operacion:GESTIONAR_SERVICIOS',
          resultado: 'DENEGADO',
        },
        tenantId: TENANT,
      },
    ]);
  });

  it('devuelve el alcance: el barbero solo sus recursos, el propietario todos', async () => {
    await expect(autorizacion.exigir(actor('BARBERO'), 'VER_AGENDA')).resolves.toBe('PROPIOS');
    await expect(autorizacion.exigir(actor('PROPIETARIO'), 'VER_AGENDA')).resolves.toBe('TODOS');
    await expect(autorizacion.exigir(actor('CLIENTE'), 'RESERVAR_CITA')).resolves.toBe('PROPIOS');
    expect(auditoria.registros).toHaveLength(0);
  });

  it.each([
    ['BARBERO', 'RESERVAR_CITA'],
    ['BARBERO', 'CANCELAR_CITA'],
    ['CLIENTE', 'VER_AGENDA'],
    ['PROPIETARIO', 'VER_HISTORIAL'],
  ] as const)('%s no puede %s', async (rol, operacion) => {
    await expect(autorizacion.exigir(actor(rol), operacion)).rejects.toBeInstanceOf(AccesoDenegado);
  });
});

describe('Las matrices de M01 y M02 coinciden con contracts/rbac.md de 002', () => {
  const RBAC_MD = join(
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
    'rbac.md',
  );
  const texto = readFileSync(RBAC_MD, 'utf8');
  const filas = texto
    .split(/\r?\n/)
    .filter((linea) => linea.startsWith('| `'))
    .map((linea) =>
      linea
        .split('|')
        .slice(1, -1)
        .map((celda) => celda.trim()),
    );

  type Celda = 'TODOS' | 'PROPIOS' | null;
  // En el markdown el asterisco va escapado (✓\*): se quitan las barras antes de leer la celda.
  const leer = (celda: string): Celda => {
    const limpia = celda.replace(/\\/g, '');
    if (limpia.startsWith('✓*')) return 'PROPIOS';
    return limpia.startsWith('✓') ? 'TODOS' : null;
  };

  // Fila del contrato → operaciones de M02 que representa.
  const M02_POR_FILA: [string, OperacionCatalogoCitas[]][] = [
    ['`GET /barberia`, `GET /barberia/horario`', ['VER_HORARIO_ATENCION']],
    ['`PATCH /barberia`, `PUT /barberia/horario`', ['GESTIONAR_HORARIO_ATENCION']],
    ['`GET /servicios`, `GET /barberos`', ['VER_CATALOGO']],
    ['`POST /servicios`, `PATCH /servicios/{id}`', ['GESTIONAR_SERVICIOS']],
    ['`POST /barberos`, `PATCH /barberos/{id}`', ['GESTIONAR_BARBEROS']],
    ['`GET`/`PUT /barberos/{id}/disponibilidad`', ['GESTIONAR_DISPONIBILIDAD']],
    ['`GET`/`POST /barberos/{id}/bloqueos`', ['GESTIONAR_BLOQUEOS']],
    ['`GET /horarios`', ['CONSULTAR_HORARIOS']],
    ['`POST /citas`', ['RESERVAR_CITA']],
    ['`POST /citas/{id}/cancelar`', ['CANCELAR_CITA']],
    ['`POST /citas/{id}/estado`', ['CAMBIAR_ESTADO_CITA']],
    ['`GET /agenda`', ['VER_AGENDA']],
    ['`GET /clientes/yo/citas`', ['VER_HISTORIAL']],
  ];

  // Operaciones de M01 que agrega la funcionalidad 002 (y las de sesión, ahora también para CLIENTE).
  const M01_POR_FILA: [string, Operacion[]][] = [
    ['`POST /auth/barberia`', ['CAMBIAR_BARBERIA']],
    ['`POST /auth/logout`, `GET /auth/yo`', ['CERRAR_SESION', 'VER_USUARIO_ACTUAL']],
    ['`GET /barberia`, `GET /barberia/horario`', ['VER_BARBERIA']],
    ['`PATCH /barberia`, `PUT /barberia/horario`', ['ACTUALIZAR_BARBERIA']],
    ['`GET /clientes`, `POST /clientes`', ['BUSCAR_CLIENTES', 'REGISTRAR_CLIENTE_PRESENCIAL']],
  ];

  const celdas = (prefijo: string) => {
    const fila = filas.find(([operacion]) => operacion.startsWith(prefijo));
    if (!fila) throw new Error(`No está la fila ${prefijo} en rbac.md`);
    const [, , propietario, barbero, cliente] = fila;
    return { PROPIETARIO: leer(propietario), BARBERO: leer(barbero), CLIENTE: leer(cliente) };
  };

  it('la tabla tiene las columnas PUB, PROPIETARIO, BARBERO y CLIENTE', () => {
    const encabezado = texto.split(/\r?\n/).find((linea) => linea.startsWith('| Operación'));
    expect(
      encabezado
        ?.split('|')
        .map((celda) => celda.trim())
        .filter(Boolean),
    ).toEqual(['Operación', 'PUB', 'PROPIETARIO', 'BARBERO', 'CLIENTE']);
  });

  it('cada operación de M02 aparece en la tabla', () => {
    const cubiertas = M02_POR_FILA.flatMap(([, operaciones]) => operaciones).sort();
    expect(cubiertas).toEqual([...OPERACIONES_CATALOGO_CITAS].sort());
  });

  it.each(M02_POR_FILA)(
    '%s: PermisosCatalogoCitas coincide con el contrato (permiso y alcance)',
    (prefijo, operaciones) => {
      const contrato = celdas(prefijo);
      for (const operacion of operaciones) {
        for (const rol of ['PROPIETARIO', 'BARBERO', 'CLIENTE'] as const) {
          expect({ operacion, rol, alcance: PermisosCatalogoCitas.alcance(rol, operacion) }).toEqual({
            operacion,
            rol,
            alcance: contrato[rol],
          });
        }
      }
    },
  );

  it.each(M01_POR_FILA)('%s: Permisos de M01 coincide con el contrato', (prefijo, operaciones) => {
    const contrato = celdas(prefijo);
    for (const operacion of operaciones) {
      for (const rol of ['PROPIETARIO', 'BARBERO', 'CLIENTE'] as const) {
        expect({ operacion, rol, permitido: Permisos.permite(rol, operacion) }).toEqual({
          operacion,
          rol,
          permitido: contrato[rol] !== null,
        });
      }
    }
  });
});
