import type { Config } from 'jest';

// Pruebas de integración y de contrato contra PostgreSQL real (RLS activo).
// La base la levanta test/helpers/test-db.ts: Testcontainers o, si existe
// TEST_DATABASE_ADMIN_URL, un PostgreSQL ya disponible (ver test/helpers/test-db.ts).
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/integration/**/*.spec.ts', '<rootDir>/test/contract/**/*.spec.ts'],
  globalSetup: '<rootDir>/test/helpers/global-setup.ts',
  globalTeardown: '<rootDir>/test/helpers/global-teardown.ts',
  setupFiles: ['reflect-metadata', '<rootDir>/test/helpers/entorno.ts'],
  testTimeout: 60_000,
  clearMocks: true,
};

export default config;
