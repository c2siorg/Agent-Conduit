// Flat ESLint config (scaffold). Tighten rules as implementations land.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'apps/dashboard/dist/**', 'packages/cli/bin/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Scaffold stubs carry injected-but-unused deps + placeholder params — ignore `_`-prefixed.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Tests + example/demo code use `any` for in-memory mock storage stubs — that's intentional and not
    // worth typing fully. Production source keeps the strict rule.
    files: ['test/**', '**/examples/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
