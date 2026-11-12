/**
 * PR14 · Reglas de arquitectura (principios I y II de la constitución, estilo-arquitectonico.md §3).
 * Los patrones no están anclados al inicio para poder probarlos también sobre test/architecture/fixture.
 * Grupos: en '(^|/)src/modules/([^/]+)/' el nombre del módulo es $2.
 */
const FRAMEWORKS =
  'node_modules/(@nestjs|kysely|pg|argon2|jose|express|class-validator|class-transformer|cookie-parser|ioredis|nodemailer)/';

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
      comment:
        'Los módulos importan M06 solo desde shared/index.ts o shared/nucleo.ts. Entradas aparte: ' +
        'shared/lectura-publica.ts (ADR-021), shared/lectura-plataforma.ts (ADR-031) y ' +
        'shared/enlaces-firmados.ts (ADR-032), cada una confinada por su propia regla.',
      severity: 'error',
      from: { path: '(^|/)src/modules/' },
      to: {
        path: '(^|/)src/shared/',
        pathNot: [
          '(^|/)src/shared/(index|nucleo)\\.ts$',
          '(^|/)src/shared/lectura-publica\\.ts$',
          '(^|/)src/shared/lectura-plataforma\\.ts$',
          '(^|/)src/shared/enlaces-firmados\\.ts$',
        ],
      },
    },
    {
      name: 'lectura-plataforma-confinada',
      comment:
        'El pool de barberias_plataforma (shared/lectura-plataforma.ts, ADR-031) solo lo usan las carpetas ' +
        'infrastructure/plataforma/ de M03, de M01 (barberias e identidad) y de M05, y la lista de pendientes ' +
        'del despacho de eventos de M06 (004, ADR-025: solo columnas técnicas).',
      severity: 'error',
      from: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/modules/suscripciones-pagos/[^/]+/infrastructure/plataforma/',
          '(^|/)src/modules/acceso-barberias/(barberias|identidad)/infrastructure/plataforma/',
          '(^|/)src/modules/notificaciones/infrastructure/plataforma/',
          '(^|/)src/shared/eventos/pendientes-plataforma\\.ts$',
        ],
      },
      to: { path: '(^|/)src/shared/lectura-plataforma\\.ts$' },
    },
    {
      name: 'pasarela-solo-por-puerto',
      comment:
        'Solo pagos/infrastructure/ de M03 importa los adaptadores de la pasarela; el resto usa el puerto ' +
        'PaymentGateway (principio V, ADR-022).',
      severity: 'error',
      from: { path: '(^|/)src/', pathNot: '(^|/)src/modules/suscripciones-pagos/pagos/infrastructure/' },
      to: {
        path: '(^|/)src/modules/suscripciones-pagos/pagos/infrastructure/pasarela-[^/]+\\.adapter\\.ts$',
      },
    },
    {
      name: 'pasarela-solo-por-puerto',
      comment:
        'Las capas de aplicación y de dominio no hablan HTTP (node:http, node:https): el proveedor se alcanza ' +
        'por el puerto (principio V). El uso de fetch lo revisa test/architecture/reglas.spec.ts.',
      severity: 'error',
      from: { path: '(^|/)src/modules/[^/]+/[^/]+/(application|domain)/' },
      to: { dependencyTypes: ['core'], path: '^(node:)?(http|https|http2|net|tls)$' },
    },
    {
      name: 'simulador-fuera-del-monolito',
      comment:
        'El simulador de la pasarela (simulador-pagos/) es una herramienta de desarrollo y pruebas: ningún ' +
        'archivo de src/ lo importa, así nunca llega a producción (ADR-022, R02).',
      severity: 'error',
      from: { path: '(^|/)src/' },
      to: { path: '(^|/)simulador-pagos/' },
    },
    {
      name: 'simulador-whatsapp-fuera-del-monolito',
      comment:
        'El simulador de WhatsApp (simulador-whatsapp/) es un servicio aparte de desarrollo y pruebas: ningún ' +
        'archivo de src/ lo importa; el monolito solo le habla por HTTP tras NotificationChannel (ADR-026, 004 T115).',
      severity: 'error',
      from: { path: '(^|/)src/' },
      to: { path: '(^|/)simulador-whatsapp/' },
    },
    {
      name: 'adelantos-solo-por-api',
      comment:
        'El submódulo de adelantos de M03 (suscripciones-pagos/adelantos/) solo se usa dentro de M03: M02 y el ' +
        'resto llaman al adelanto por AdelantosApi, desde el index.ts de M03 (008, research R01).',
      severity: 'error',
      from: { path: '(^|/)src/', pathNot: '(^|/)src/modules/suscripciones-pagos/' },
      to: { path: '(^|/)src/modules/suscripciones-pagos/adelantos/' },
    },
    {
      name: 'adelantos-sin-pasarela',
      comment:
        'El adelanto lo paga el cliente directamente a la barbería: el submódulo de adelantos no usa ' +
        'PaymentGateway ni sus adaptadores (principio V, ADR-033, FR-027 de 008).',
      severity: 'error',
      from: { path: '(^|/)src/modules/suscripciones-pagos/adelantos/' },
      to: {
        path: [
          '(^|/)src/modules/suscripciones-pagos/pagos/application/ports/payment-gateway\\.ts$',
          '(^|/)src/modules/suscripciones-pagos/pagos/infrastructure/',
        ],
      },
    },
    {
      name: 'lectura-publica-confinada',
      comment:
        'El pool de barberias_publico (shared/lectura-publica.ts) solo lo usa la vía pública de M02 ' +
        '(catalogo-citas/catalogo/infrastructure/publico/), ADR-021.',
      severity: 'error',
      from: {
        path: '(^|/)src/',
        pathNot: '(^|/)src/modules/catalogo-citas/catalogo/infrastructure/publico/',
      },
      to: { path: '(^|/)src/shared/lectura-publica\\.ts$' },
    },
    {
      name: 'redis-confinado',
      comment:
        'Solo el adaptador de la caché compartida de M06 (shared/cache/) importa ioredis; el resto usa el ' +
        'puerto CacheCompartida (ADR-029, principio II).',
      severity: 'error',
      from: { path: '(^|/)src/', pathNot: '(^|/)src/shared/cache/' },
      to: { path: 'node_modules/ioredis/' },
    },
    {
      name: 'm06-sin-modulos-de-negocio',
      comment: 'M06 no depende de módulos de negocio ni del host.',
      severity: 'error',
      from: { path: '(^|/)src/shared/' },
      to: { path: '(^|/)src/(modules|host)/' },
    },
    {
      name: 'matriz-m01',
      comment: 'Matriz de dependencias: M01 puede llamar a M03 y M06, nunca a M02 (sin ciclos, ADR-020).',
      severity: 'error',
      from: { path: '(^|/)src/modules/acceso-barberias/' },
      to: { path: '(^|/)src/modules/catalogo-citas/' },
    },
    {
      name: 'matriz-m02',
      comment:
        'Matriz de dependencias: M02 solo puede llamar a M01 (ADR-020) y M03 por su index.ts, y a M06; ' +
        'nunca a M04, M05 ni a clases internas de otros módulos.',
      severity: 'error',
      from: { path: '(^|/)src/modules/catalogo-citas/' },
      to: {
        path: '(^|/)src/modules/',
        pathNot: [
          '(^|/)src/modules/catalogo-citas/',
          '(^|/)src/modules/acceso-barberias/index\\.ts$',
          '(^|/)src/modules/suscripciones-pagos/index\\.ts$',
        ],
      },
    },
    {
      name: 'matriz-m03',
      comment: 'Matriz de dependencias: M03 solo puede llamar a M06 (no a M01 ni a M02).',
      severity: 'error',
      from: { path: '(^|/)src/modules/suscripciones-pagos/' },
      to: { path: '(^|/)src/modules/(acceso-barberias|catalogo-citas)/' },
    },
    {
      name: 'matriz-m05',
      comment:
        'Matriz de dependencias (revisión de ADR-013): M05 solo puede llamar a M01 por su index.ts (lectura de ' +
        'canal, consentimiento y correos) y a M06.',
      severity: 'error',
      from: { path: '(^|/)src/modules/notificaciones/' },
      to: {
        path: '(^|/)src/modules/',
        pathNot: ['(^|/)src/modules/notificaciones/', '(^|/)src/modules/acceso-barberias/index\\.ts$'],
      },
    },
    {
      name: 'm05-sin-llamadas',
      comment:
        'Nadie llama a M05: recibe los hechos por el bus de eventos de M06, suscrito desde el host (ADR-025). ' +
        'Solo la raíz de composición importa su módulo.',
      severity: 'error',
      from: { path: '(^|/)src/modules/', pathNot: '(^|/)src/modules/notificaciones/' },
      to: { path: '(^|/)src/modules/notificaciones/' },
    },
    {
      name: 'canal-solo-por-puerto',
      comment:
        'Los adaptadores de canal (canal-*.ts) solo los usa notificaciones/infrastructure/ (su fábrica); el ' +
        'resto envía por el puerto NotificationChannel (ADR-026).',
      severity: 'error',
      from: { path: '(^|/)src/', pathNot: '(^|/)src/modules/notificaciones/infrastructure/' },
      to: { path: '(^|/)src/modules/notificaciones/infrastructure/canal-[^/]+\\.ts$' },
    },
    {
      name: 'eventos-solo-por-bus',
      comment:
        'La salida transaccional (shared/eventos/salida-postgres.ts) solo se usa dentro de shared/eventos/ y ' +
        'desde el registro de M06; los casos de uso publican por el puerto BusDeEventos (ADR-025).',
      severity: 'error',
      from: {
        path: '(^|/)src/',
        pathNot: ['(^|/)src/shared/eventos/', '(^|/)src/shared/shared\\.module\\.ts$'],
      },
      to: { path: '(^|/)src/shared/eventos/salida-postgres\\.ts$' },
    },
    {
      name: 'enlaces-confinados',
      comment:
        'Los enlaces firmados (shared/enlaces-firmados.ts, ADR-032) solo los usa M05, que los emite en el ' +
        'recordatorio, y las rutas de enlaces de M02, que los verifican.',
      severity: 'error',
      from: {
        path: '(^|/)src/',
        pathNot: [
          '(^|/)src/modules/notificaciones/',
          '(^|/)src/modules/catalogo-citas/citas/(application/accion-por-enlace|presentation/enlaces\\.controller)\\.ts$',
        ],
      },
      to: { path: '(^|/)src/shared/enlaces-firmados\\.ts$' },
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
          // 004 (ADR-025): la salida de eventos, su despacho y la lista de pendientes son persistencia de M06.
          '(^|/)src/shared/eventos/(salida-postgres|despachador|pendientes-plataforma)\\.ts$',
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
