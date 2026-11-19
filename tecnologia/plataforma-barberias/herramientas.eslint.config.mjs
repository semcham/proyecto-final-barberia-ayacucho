// Funcionalidad 009 (análisis A2 y M9): ESLint 9 para las carpetas nuevas de herramientas (scripts/, semilla/,
// carga/, e2e/, publicacion/ y evidencia/scripts/). Sin importar paquetes: así `npx eslint@9.39.5 -c
// herramientas.eslint.config.mjs …` funciona en la CI sin instalar nada. evidencia/ (salvo evidencia/scripts/) son
// salidas crudas de herramientas y no se revisan. backend/ y frontend/ tienen su propia configuración.

const NODE = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  Response: 'readonly',
  Request: 'readonly',
  Headers: 'readonly',
  AbortSignal: 'readonly',
  AbortController: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  structuredClone: 'readonly',
  globalThis: 'readonly',
};

// Globales del entorno de k6 (solo para carga/).
const K6 = { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly', open: 'readonly', console: 'readonly' };

const REGLAS = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
  'no-unreachable': 'error',
  'no-dupe-keys': 'error',
  'no-duplicate-case': 'error',
  'no-redeclare': 'error',
  'no-self-assign': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-constant-condition': ['error', { checkLoops: false }],
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'always'],
};

export default [
  { ignores: ['**/node_modules/**', 'backend/**', 'frontend/**', 'publicacion/secretos/**'] },
  {
    files: [
      'scripts/**/*.mjs',
      'semilla/**/*.mjs',
      'publicacion/**/*.mjs',
      'evidencia/scripts/**/*.mjs',
      'e2e/**/*.mjs',
      '*.config.mjs',
    ],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: NODE },
    rules: REGLAS,
  },
  {
    files: ['carga/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: K6 },
    rules: REGLAS,
  },
  {
    files: ['carga/**/*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: NODE },
    rules: REGLAS,
  },
];
