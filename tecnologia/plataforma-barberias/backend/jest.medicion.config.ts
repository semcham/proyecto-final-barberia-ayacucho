import type { Config } from 'jest';
import base from './jest.int.config';

// 010 (T072; research R07; SC-005): medición de tiempos de las respuestas neutras de los enlaces de cuenta. No la
// recoge test:int. En la verificación local se exige con su umbral estricto; en la CI corre como paso propio y no
// bloqueante (continue-on-error), porque los tiempos de los ejecutores compartidos varían por causas ajenas al código.
const config: Config = {
  ...base,
  testMatch: ['<rootDir>/test/integration/**/*.medicion.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
  testTimeout: 600_000,
};

export default config;
