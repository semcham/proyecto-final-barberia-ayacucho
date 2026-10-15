/**
 * PR14 · Reglas de arquitectura (principios I y II de la constitución, estilo-arquitectonico.md §3).
 * Los patrones no están anclados al inicio para poder probarlos también sobre test/architecture/fixture.
 * Grupos: en '(^|/)src/modules/([^/]+)/' el nombre del módulo es $2.
 */
const FRAMEWORKS =
  'node_modules/(@nestjs|kysely|pg|argon2|jose|express|class-validator|class-transformer|cookie-parser)/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'sin-ciclos',
      comment: 'El grafo de dependencias debe ser acíclico.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'dominio-sin-frameworks',
      comment:
        'La capa de dominio no importa frameworks, ORM, PostgreSQL ni SDK de proveedores (principio II).',
      severity: 'error',
      from: { path: '(^|/)src/modules/.+/domain/' },
      to: { path: FRAMEWORKS },
    },
    {
      name: 'dominio-solo-dominio',
      comment: 'El dominio no importa las capas de aplicación, infraestructura ni presentación.',
      severity: 'error',
      from: { path: '(^|/)src/modules/[^/]+/[^/]+/domain/' },
      to: { path: '(^|/)src/modules/[^/]+/[^/]+/(application|infrastructure|presentation)/' },
    },
    {
      name: 'dominio-solo-nucleo-puro',
      comment: 'De M06, el dominio solo puede importar la interfaz pura shared/nucleo.ts.',
      severity: 'error',
      from: { path: '(^|/)src/modules/.+/domain/' },
      to: { path: '(^|/)src/(shared|host)/', pathNot: '(^|/)src/shared/nucleo\\.ts$' },
    },
    {
      name: 'aplicacion-sin-infraestructura',
      comment: 'La capa de aplicación define puertos; no importa infraestructura ni presentación.',
      severity: 'error',
      from: { path: '(^|/)src/modules/[^/]+/[^/]+/application/' },
      to: { path: '(^|/)src/modules/[^/]+/[^/]+/(infrastructure|presentation)/' },
    },
    {
      name: 'modulos-solo-por-index',
      comment: 'Un módulo solo importa otro módulo a través de su index.ts (principio I).',
      severity: 'error',
      from: { path: '(^|/)src/modules/([^/]+)/' },
      to: {
        path: '(^|/)src/modules/[^/]+/',
        pathNot: ['(^|/)src/modules/$2/', '(^|/)src/modules/[^/]+/index\\.ts$'],
      },
    },
    {
      name: 'm06-solo-por-interfaz-publica',
      comment: 'Los módulos importan M06 solo desde shared/index.ts o shared/nucleo.ts.',
      severity: 'error',
      from: { path: '(^|/)src/modules/' },
      to: { path: '(^|/)src/shared/', pathNot: '(^|/)src/shared/(index|nucleo)\\.ts$' },
    },
    {
      name: 'm06-sin-modulos-de-negocio',
      comment: 'M06 no depende de módulos de negocio ni del host.',
      severity: 'error',
      from: { path: '(^|/)src/shared/' },
      to: { path: '(^|/)src/(modules|host)/' },
    },
    {
      name: 'matriz-m03',
      comment: 'Matriz de dependencias: M03 solo puede llamar a M06 (no a M01).',
      severity: 'error',
      from: { path: '(^|/)src/modules/suscripciones-pagos/' },
      to: { path: '(^|/)src/modules/acceso-barberias/' },
    },
    {
      name: 'kysely-solo-en-infraestructura',
      comment:
        'Solo los repositorios (infrastructure/) y la persistencia de M06 consultan la base: ningún controlador ' +
        'ni caso de uso puede saltarse un repositorio con contexto de tenant (T095, principio III).',
      severity: 'error',
      from: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/modules/.+/infrastructure/',
          '(^|/)src/shared/persistence/',
          '(^|/)src/shared/(index|shared\\.module)\\.ts$',
        ],
      },
      to: { path: ['node_modules/kysely/', '(^|/)src/shared/persistence/database\\.ts$'] },
    },
    {
      name: 'modulos-sin-host',
      comment: 'Solo el host (raíz de composición) ensambla módulos; ningún módulo depende del host.',
      severity: 'error',
      from: { path: '(^|/)src/modules/' },
      to: { path: '(^|/)src/host/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default'],
    },
  },
};
