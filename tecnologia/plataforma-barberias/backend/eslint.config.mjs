// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

const MODULOS = ['acceso-barberias', 'suscripciones-pagos'];

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', 'node_modules/', 'test/architecture/fixture/'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
  },
  {
    files: ['**/*.ts'],
    rules: {
      // Sin consistent-type-imports: con emitDecoratorMetadata, Nest necesita importaciones de valor
      // para resolver las dependencias del constructor.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Entre módulos solo se importa su interfaz pública (index.ts). La matriz completa la verifica PR14.
  ...MODULOS.map((modulo) => ({
    files: [`src/modules/${modulo}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: MODULOS.filter((otro) => otro !== modulo).map((otro) => ({
            group: [`**/modules/${otro}/*`, `!**/modules/${otro}/index`],
            message: `Importa ${otro} solo a través de su index.ts (interfaz pública del módulo).`,
          })),
        },
      ],
    },
  })),
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/modules/**'], message: 'M06 no depende de módulos de negocio.' }] },
      ],
    },
  },
);
