import type { Config } from 'jest';

// Pruebas unitarias: dominio y aplicación sin infraestructura (sin base de datos).
const config: Config = {
  rootDir: '.',
  testEnvironment: 'node',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  setupFiles: ['reflect-metadata'],
  clearMocks: true,
};

export default config;
