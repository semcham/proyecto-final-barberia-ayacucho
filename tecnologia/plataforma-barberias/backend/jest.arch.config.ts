import type { Config } from 'jest';

// PR14: pruebas de la configuración de arquitectura (matriz de módulos y regla de capas).
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/architecture/**/*.spec.ts'],
  testTimeout: 60_000,
};

export default config;
