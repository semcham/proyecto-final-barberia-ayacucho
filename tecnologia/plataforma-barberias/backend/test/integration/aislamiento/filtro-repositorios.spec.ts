import { Kysely, type LogEvent, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { KyselyTermsAcceptanceRepository } from '../../../src/modules/acceso-barberias/barberias/infrastructure/kysely-terms-acceptance-repository';
import { AceptacionTerminos } from '../../../src/modules/acceso-barberias/barberias/domain/aceptacion-terminos';
import { KyselySesionRepository } from '../../../src/modules/acceso-barberias/identidad/infrastructure/kysely-sesion-repository';
import { KyselyUsuarioRepository } from '../../../src/modules/acceso-barberias/identidad/infrastructure/kysely-usuario-repository';
import { Correo } from '../../../src/modules/acceso-barberias/identidad/domain/correo';
import { Membresia } from '../../../src/modules/acceso-barberias/identidad/domain/membresia';
import { NombrePersona } from '../../../src/modules/acceso-barberias/identidad/domain/nombre-persona';
import { Sesion } from '../../../src/modules/acceso-barberias/identidad/domain/sesion';
import { KyselySuscripcionRepository } from '../../../src/modules/suscripciones-pagos/suscripciones/infrastructure/kysely-suscripcion-repository';
import { Plan } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/plan';
import { Suscripcion } from '../../../src/modules/suscripciones-pagos/suscripciones/domain/suscripcion';
import { type Database, KyselyUnitOfWork, TenantContext, TenantId } from '../../../src/shared';
import { type BarberiaSembrada, sembrarBarberia } from '../../helpers/fixtures';
import { cerrarPools } from '../../helpers/test-db';

// T093 · Principio III (defensa en profundidad): cada consulta de un repositorio sobre una tabla con
// tenant_id filtra explícitamente por el tenant del contexto, además de RLS. Se capturan todas las
// sentencias que envía cada método y se comprueba el filtro (o el valor insertado).

const TABLAS_CON_TENANT = [
  'membership',
  'auth_session',
  'account_activation',
  'terms_acceptance',
  'subscription',
  'audit_log',
];

interface Sentencia {
  sql: string;
  parametros: readonly unknown[];
}

/** Problema de una sentencia, o null si cumple el principio III. */
function problemaDeFiltro(sentencia: Sentencia, tenantId: string): string | null {
  const sqlMinuscula = sentencia.sql.toLowerCase();
  // Excepciones: fijar el tenant y las búsquedas previas a conocerlo (ADR-015).
  if (sqlMinuscula.includes('set_config(') || /from auth_\w+\(/.test(sqlMinuscula)) return null;
  const tablas = [...sqlMinuscula.matchAll(/(?:from|into|update|join)\s+"(\w+)"/g)].map((m) => m[1]);
  const conTenant = tablas.filter((tabla) => TABLAS_CON_TENANT.includes(tabla));
  if (conTenant.length === 0) return null;

  if (sqlMinuscula.startsWith('insert')) {
    return sqlMinuscula.includes('"tenant_id"') && sentencia.parametros.includes(tenantId)
      ? null
      : `INSERT en ${conTenant.join(', ')} sin el tenant del contexto`;
  }
  // Con varias tablas por tenant en la misma consulta, cada una necesita su filtro calificado ("tabla"."tenant_id").
  const calificado = new Set(conTenant).size > 1;
  const faltantes = conTenant.filter((tabla) => {
    const patron = new RegExp(
      `${calificado ? `"${tabla}"\\.` : `(?:"${tabla}"\\.)?`}"tenant_id" = \\$(\\d+)`,
      'g',
    );
    return ![...sqlMinuscula.matchAll(patron)].some(
      (m) => sentencia.parametros[Number(m[1]) - 1] === tenantId,
    );
  });
  return faltantes.length === 0
    ? null
    : `consulta sobre ${faltantes.join(', ')} sin filtro tenant_id = contexto`;
}

describe('PR09 · Filtro explícito por tenant en los repositorios (principio III)', () => {
  let db: Kysely<Database>;
  let uow: KyselyUnitOfWork;
  let contexto: TenantContext;
  let a: BarberiaSembrada;
  let capturadas: Sentencia[] = [];

  beforeAll(async () => {
    db = new Kysely<Database>({
      dialect: new PostgresDialect({
        pool: new Pool({ connectionString: process.env.TEST_DB_APP_URL, max: 2 }),
      }),
      log: (evento: LogEvent) => {
        capturadas.push({ sql: evento.query.sql, parametros: evento.query.parameters });
      },
    });
    contexto = new TenantContext();
    uow = new KyselyUnitOfWork(db, contexto);
    a = await sembrarBarberia();
  });

  afterAll(async () => {
    await db.destroy();
    await cerrarPools();
  });

  /** Ejecuta `fn` en el tenant A, revierte todo al final y devuelve las sentencias que envió. */
  async function sentenciasDe(fn: () => Promise<unknown>): Promise<Sentencia[]> {
    const deshacer = new Error('deshacer');
    capturadas = [];
    await uow
      .ejecutar(TenantId.de(a.tenantId), async () => {
        await fn();
        throw deshacer;
      })
      .catch((error: unknown) => {
        if (error !== deshacer) throw error;
      });
    return capturadas.filter((s) => !/^(begin|commit|rollback)/i.test(s.sql));
  }

  function verificar(sentencias: Sentencia[]): void {
    expect(sentencias.length).toBeGreaterThan(0);
    const problemas = sentencias
      .map((s) => problemaDeFiltro(s, a.tenantId))
      .filter((p): p is string => p !== null);
    expect(problemas).toEqual([]);
  }

  it('el verificador detecta una consulta sin filtro y una con el tenant equivocado', () => {
    expect(
      problemaDeFiltro({ sql: 'select * from "membership"', parametros: [] }, a.tenantId),
    ).not.toBeNull();
    expect(
      problemaDeFiltro(
        { sql: 'select * from "membership" where "tenant_id" = $1', parametros: ['otro'] },
        a.tenantId,
      ),
    ).not.toBeNull();
    expect(
      problemaDeFiltro(
        { sql: 'select * from "membership" where "tenant_id" = $1', parametros: [a.tenantId] },
        a.tenantId,
      ),
    ).toBeNull();
    // Un join entre dos tablas por tenant con un solo filtro no basta.
    expect(
      problemaDeFiltro(
        {
          sql: 'select * from "auth_session" inner join "membership" on 1=1 where "auth_session"."tenant_id" = $1',
          parametros: [a.tenantId],
        },
        a.tenantId,
      ),
    ).toMatch(/membership/);
  });

  describe('KyselySesionRepository', () => {
    const repo = () => new KyselySesionRepository(uow, contexto);
    const nueva = () => Sesion.iniciar(uuidv7(), a.tenantId, a.propietarioId, 'a'.repeat(64), new Date());

    it.each([
      ['crear', () => repo().crear(nueva(), {})],
      ['obtener', () => repo().obtener(uuidv7())],
      ['guardar', () => repo().guardar(nueva())],
      ['guardarRotacion', () => repo().guardarRotacion(nueva(), 'b'.repeat(64))],
      ['revocarTodasDe', () => repo().revocarTodasDe(a.propietarioId, new Date())],
      ['purgarTerminadasDe', () => repo().purgarTerminadasDe(a.propietarioId, new Date())],
      ['estadoDeAcceso', () => repo().estadoDeAcceso(uuidv7(), a.propietarioId)],
    ])('%s', async (_metodo, llamar) => verificar(await sentenciasDe(llamar)));
  });

  describe('KyselyUsuarioRepository', () => {
    const repo = () => new KyselyUsuarioRepository(uow, contexto);

    it('crearCuenta + crearMembresia', async () => {
      verificar(
        await sentenciasDe(async () => {
          const usuarioId = uuidv7();
          await repo().crearCuenta({
            id: usuarioId,
            correo: Correo.crear(`filtro-${uuidv7()}@prueba.pe`),
            nombre: NombrePersona.crear('Prueba de Filtro'),
            hashContrasena: null,
          });
          await repo().crearMembresia(Membresia.crearBarberoPendiente(uuidv7(), a.tenantId, usuarioId));
        }),
      );
    });

    it('perfil', async () => verificar(await sentenciasDe(() => repo().perfil(a.propietarioId))));
  });

  it('KyselyTermsAcceptanceRepository.registrar', async () => {
    const repo = new KyselyTermsAcceptanceRepository(uow, contexto);
    verificar(
      await sentenciasDe(() =>
        repo.registrar(a.propietarioId, AceptacionTerminos.aceptar('TERMINOS', '2026-10', '2026-10'), {}),
      ),
    );
  });

  describe('KyselySuscripcionRepository', () => {
    const repo = () => new KyselySuscripcionRepository(uow, contexto);

    it('crear', async () => {
      const plan = Plan.reconstruir({
        id: '01923a00-0000-7000-8000-000000000001',
        codigo: 'TRIAL',
        diasPrueba: 14,
        maxUsuarios: 5,
      });
      verificar(
        await sentenciasDe(() =>
          repo().crear(Suscripcion.iniciarPrueba(uuidv7(), a.tenantId, plan, new Date())),
        ),
      );
    });

    it('planDelTenant', async () => verificar(await sentenciasDe(() => repo().planDelTenant())));
  });
});
